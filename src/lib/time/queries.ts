import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { resolveUserTimeZone } from "@/lib/datetime/user-timezone";
import { zonedDayOf, zonedWallTimeToUtc } from "@/lib/datetime/timezone";
import { weekDays, assembleTimeCard } from "@/lib/time/card";
import { PRESET_CATEGORIES } from "@/lib/time/categories";
import type {
  TimeAllocationRow,
  TimeCardData,
  TimerSecsByItemDay,
} from "./types";

/** One person's week: their manual allocations + their timer totals + item
 * metadata, assembled into the card. Bounded by [weekStart, weekStart+6]: the
 * allocations read filters time_allocations on (user_id, work_date); the
 * completed-timer read is served by the partial index time_entries_user_started_idx
 * ((user_id, started_at) where ended_at is not null). */
export async function getTimeCardData(
  weekStart: string,
): Promise<TimeCardData> {
  const user = await getUser();
  const userId = user?.id ?? "";
  const days = weekDays(weekStart);
  const from = days[0];
  const to = days[6];

  // Bucket timer instants into the USER's local calendar day, not the UTC day.
  // The week window and each entry's day are computed in this zone, so a timer
  // run at 5pm local Monday lands under Monday regardless of UTC offset.
  const timeZone = await resolveUserTimeZone(userId);
  // UTC bounds of the local week [Mon 00:00 local, Mon+7 00:00 local) — the
  // exclusive upper bound is the local midnight after Sunday (hour=24 of `to`).
  const windowStart = zonedWallTimeToUtc(from, 0, timeZone).toISOString();
  const windowEnd = zonedWallTimeToUtc(to, 24, timeZone).toISOString();

  const supabase = await createClient();

  // Manual allocations for the caller's week (RLS already scopes to org members;
  // filter to self for the card surface). A failed read must NOT masquerade as an
  // empty week — throw so the /time route's error.tsx boundary renders a visible
  // error state (distinct from "no time logged").
  const { data: allocRows, error: allocErr } = await supabase
    .from("time_allocations")
    .select("*")
    .eq("user_id", userId)
    .gte("work_date", from)
    .lte("work_date", to);
  if (allocErr)
    throw new Error(`Failed to load time allocations: ${allocErr.message}`);
  const allocations = (allocRows ?? []) as TimeAllocationRow[];

  // Timer totals for the caller's week (completed entries only).
  const { data: timerRows, error: timerErr } = await supabase
    .from("time_entries")
    .select("item_id, started_at, duration_secs")
    .eq("user_id", userId)
    .not("ended_at", "is", null)
    .gte("started_at", windowStart)
    .lt("started_at", windowEnd);
  if (timerErr)
    throw new Error(`Failed to load timer entries: ${timerErr.message}`);

  const timer: TimerSecsByItemDay[] = (timerRows ?? []).map((r) => ({
    itemId: r.item_id,
    day: zonedDayOf(r.started_at as string, timeZone),
    secs: Number(r.duration_secs ?? 0),
  }));

  // Item metadata (name + board name) for every referenced item.
  const itemIds = new Set<string>();
  for (const a of allocations) if (a.item_id) itemIds.add(a.item_id);
  for (const t of timer) itemIds.add(t.itemId);

  const itemMeta = new Map<
    string,
    { name: string; boardName: string | null }
  >();
  if (itemIds.size > 0) {
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("id, name, boards(name)")
      .in("id", [...itemIds])
      .is("archived_at", null);
    if (itemsErr)
      throw new Error(`Failed to load item metadata: ${itemsErr.message}`);
    for (const it of items ?? []) {
      itemMeta.set(it.id, {
        name: it.name,
        boardName: (it.boards as { name: string } | null)?.name ?? null,
      });
    }
  }

  return assembleTimeCard({ weekStart, userId, allocations, timer, itemMeta });
}

export interface AllocatableItem {
  id: string;
  name: string;
  boardId: string;
  boardName: string | null;
}

/** Cross-board item search for the add-row picker. RLS on `items` already
 * scopes to readable boards/org; bounded by ilike + LIMIT 20, top-level items
 * only (mirrors workload_rollup's parent_id is null). */
export async function searchAllocatableItems(
  q: string,
): Promise<AllocatableItem[]> {
  const term = q.trim();
  if (term === "") return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("id, name, board_id, boards(name)")
    .is("parent_id", null)
    .is("archived_at", null)
    .ilike("name", `%${term}%`)
    .limit(20);
  return (data ?? []).map((it) => ({
    id: it.id,
    name: it.name,
    boardId: it.board_id,
    boardName: (it.boards as { name: string } | null)?.name ?? null,
  }));
}

/** The caller's previously-used categories (for the add-row picker), merged with
 * presets, de-duplicated, presets first. */
export async function listUserCategories(): Promise<string[]> {
  const user = await getUser();
  const userId = user?.id ?? "";
  const supabase = await createClient();
  const { data } = await supabase
    .from("time_allocations")
    .select("category")
    .eq("user_id", userId)
    .not("category", "is", null)
    .limit(500);
  const used = new Set<string>();
  for (const r of data ?? []) if (r.category) used.add(r.category);
  const out: string[] = [...PRESET_CATEGORIES];
  for (const c of used) if (!out.includes(c)) out.push(c);
  return out;
}

/** Hot-path caps (AGENTS.md: bounded reads over indexed columns). The row read
 *  is served by the (user_id, work_date) unique partial indexes. */
export const TIME_ALLOCATIONS_LIMIT = 1000;
export const TIME_RANGE_MAX_DAYS = 92;

/** One manual allocation, flattened for agent consumption — no week/cell
 *  scaffolding (that shape exists for the grid UI only). */
export type TimeAllocationFlat = {
  date: string;
  itemId: string | null;
  itemName: string | null;
  boardId: string | null;
  category: string | null;
  secs: number;
  note: string | null;
};

/** Result of `listTimeAllocationsCore`: the (possibly capped) rows, plus
 *  whether the window held more rows than the cap. `truncated: true` means
 *  the rows below are a PREFIX, not the whole window — any total computed
 *  from them is a partial, not a total. */
export type TimeAllocationsResult = {
  rows: TimeAllocationFlat[];
  truncated: boolean;
};

/**
 * Flat manual allocations for one user over [from, to]. Client-injected so the
 * MCP path shares this implementation; the caller bounds the span
 * (`validateRange`) before calling.
 *
 * Fetches one row past the cap to detect truncation without a separate
 * COUNT query, then reports `truncated` rather than silently returning a
 * confident-looking but incomplete set — the same anti-pattern `range.ts`'s
 * docstring calls out for the day-span guard, just via row count.
 */
export async function listTimeAllocationsCore(
  supabase: SupabaseClient<Database>,
  args: { userId: string; from: string; to: string; limit?: number },
): Promise<TimeAllocationsResult> {
  // Clamp the caller-supplied limit — it must never exceed the hard cap,
  // even for future callers that pass an arbitrary `limit`.
  const effectiveLimit = Math.min(
    args.limit ?? TIME_ALLOCATIONS_LIMIT,
    TIME_ALLOCATIONS_LIMIT,
  );

  const { data, error } = await supabase
    .from("time_allocations")
    .select("work_date, item_id, board_id, category, duration_secs, note")
    .eq("user_id", args.userId)
    .gte("work_date", args.from)
    .lte("work_date", args.to)
    .order("work_date", { ascending: true })
    .limit(effectiveLimit + 1);
  if (error)
    throw new Error(`Failed to load time allocations: ${error.message}`);

  const fetched = data ?? [];
  const truncated = fetched.length > effectiveLimit;
  const rows = truncated ? fetched.slice(0, effectiveLimit) : fetched;

  const itemIds = [
    ...new Set(rows.map((r) => r.item_id).filter((id): id is string => !!id)),
  ];

  // ONE metadata read for every referenced item — never per row.
  const names = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("id, name")
      .in("id", itemIds);
    if (itemsErr)
      throw new Error(`Failed to load item metadata: ${itemsErr.message}`);
    for (const it of items ?? []) names.set(it.id, it.name);
  }

  return {
    rows: rows.map((r) => ({
      date: r.work_date,
      itemId: r.item_id,
      itemName: r.item_id ? (names.get(r.item_id) ?? null) : null,
      boardId: r.board_id,
      category: r.category,
      secs: Number(r.duration_secs ?? 0),
      note: r.note,
    })),
    truncated,
  };
}
