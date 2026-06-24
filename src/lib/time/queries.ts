import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { weekDays, assembleTimeCard } from "@/lib/time/card";
import { PRESET_CATEGORIES } from "@/lib/time/categories";
import type {
  TimeAllocationRow,
  TimeCardData,
  TimerSecsByItemDay,
} from "./types";

/** One person's week: their manual allocations + their timer totals + item
 * metadata, assembled into the card. Bounded by [weekStart, weekStart+6] over
 * the indexed (user_id, work_date) / (started_at) columns. */
export async function getTimeCardData(
  weekStart: string,
): Promise<TimeCardData> {
  const user = await getUser();
  const userId = user?.id ?? "";
  const days = weekDays(weekStart);
  const from = days[0];
  const to = days[6];

  const supabase = await createClient();

  // Manual allocations for the caller's week (RLS already scopes to org members;
  // filter to self for the card surface).
  const { data: allocRows } = await supabase
    .from("time_allocations")
    .select("*")
    .eq("user_id", userId)
    .gte("work_date", from)
    .lte("work_date", to);
  const allocations = (allocRows ?? []) as TimeAllocationRow[];

  // Timer totals for the caller's week (completed entries only).
  const { data: timerRows } = await supabase
    .from("time_entries")
    .select("item_id, started_at, duration_secs")
    .eq("user_id", userId)
    .not("ended_at", "is", null)
    .gte("started_at", `${from}T00:00:00Z`)
    .lte("started_at", `${to}T23:59:59Z`);

  const timer: TimerSecsByItemDay[] = (timerRows ?? []).map((r) => ({
    itemId: r.item_id,
    day: (r.started_at as string).slice(0, 10),
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
    const { data: items } = await supabase
      .from("items")
      .select("id, name, boards(name)")
      .in("id", [...itemIds]);
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
