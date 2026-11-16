import * as z from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { listOrgMemberProfiles } from "@/lib/mcp/org-scope";
import { nameMap, personName } from "@/lib/mcp/tools/names";
import { STALL_DAYS } from "@/lib/boards/intelligence/constants";
import { effectiveTimeZone } from "@/lib/datetime/timezone";
import { todayInTimeZone } from "./today";
import { FOCUS_TIERS, focusReason, type FocusTier } from "./reason";

export const FOCUS_LIMIT = 20;

/** The most rows the SQL function ever returns (it clamps the limit to 1..50). */
export const FOCUS_MAX_LIMIT = 50;

const waitingSchema = z.array(
  z.object({
    itemId: z.string(),
    name: z.string(),
    assigneeIds: z.array(z.string()),
  }),
);

const baseRow = {
  item_id: z.string(),
  item_name: z.string(),
  board_id: z.string(),
  board_name: z.string(),
  group_name: z.string().nullable(),
  status_label: z.string().nullable(),
  due_date: z.string().nullable(),
  days_overdue: z.number().nullable(),
  waiting_count: z.number(),
  waiting: waitingSchema,
  unread_count: z.number(),
  days_quiet: z.number().nullable(),
};

/** `get_focus_today` (the function before 20261116112326_focus_today_v2). */
const legacyRowSchema = z.object({
  ...baseRow,
  tier: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  tier_total: z.number(),
});

/** `get_focus_today_v2`. */
const v2RowSchema = z.object({
  ...baseRow,
  tier: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  tier_totals: z.record(z.string(), z.number()),
  can_edit: z.boolean(),
  has_status: z.boolean(),
  has_due: z.boolean(),
});

type V2Row = z.infer<typeof v2RowSchema>;
type LegacyRow = z.infer<typeof legacyRowSchema>;

/**
 * TYPE SHIM, to delete once migration 20261116112326_focus_today_v2 is applied
 * and `src/types/database.types.ts` is regenerated: `get_focus_today_v2` is
 * not in the generated types yet, so `typedRpc` cannot name it. This is the
 * narrowest possible stand-in (one function, its five arguments); the rows are
 * `unknown` and validated by `v2RowSchema` like any other boundary. After the
 * regeneration, call `typedRpc(supabase, "get_focus_today_v2", args)` instead.
 */
type FocusV2Rpc = {
  rpc(
    fn: "get_focus_today_v2",
    args: {
      p_org_id: string;
      p_today: string;
      p_folder_id: string | null;
      p_stall_days: number;
      p_limit: number;
    },
  ): PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

/**
 * "This function does not exist (yet)": PostgREST has no such function in its
 * schema cache (PGRST202), or Postgres itself does not (42883). The only two
 * errors that mean "the migration is not applied here", and so the only ones
 * that fall back to the older function.
 */
function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

export type FocusItem = {
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  groupName: string | null;
  status: string | null;
  dueDate: string | null;
  tier: FocusTier;
  reason: string;
  /**
   * The member may edit this item's board. False for a view-only board, and
   * for every row while the database still serves the older function (it
   * does not report access, so the list stays read-only rather than guess).
   */
  canEdit: boolean;
  /** The board has a status column to set done on. */
  canMarkDone: boolean;
  /** The board has a due date column to write to. */
  canSetDue: boolean;
};

export type FocusResult = {
  today: string;
  timezoneAssumed: boolean;
  items: FocusItem[];
  /**
   * How many items each tier holds. `null` = unknown, never reported as 0,
   * which would state a false fact. With `get_focus_today_v2` every total is
   * known. With the older function a tier the limit cut off is unknown, and
   * so is tier 0 (it has no "due today" tier: those items sit in tier 3).
   */
  totals: Record<FocusTier, number | null>;
  /**
   * `current`: due today first, then overdue most recent first, with row
   * actions. `legacy`: the older function answered (the v2 migration is not
   * applied): oldest overdue first, no "due today" tier, read-only rows.
   */
  ordering: "current" | "legacy";
};

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );

/**
 * The ranked Today list for `userId`, through the caller's own client. Shared
 * by the My Work page and the `get_focus_today` tool. Ranking, tiering and the
 * limit are all done by the SQL function; this only validates rows and words
 * the reasons. Rows are never re-ordered or re-classified here: the limit
 * already cut the list, so doing it in the app would silently drop rows.
 *
 * Calls `get_focus_today_v2` and falls back to `get_focus_today` only when v2
 * does not exist in this database, so the app works before and after the
 * migration. Any other v2 error is returned, not papered over.
 */
export async function getFocusTodayCore(
  supabase: SupabaseClient<Database>,
  args: {
    orgId: string;
    userId: string;
    /** The org's zone, used when the member has none (then UTC). */
    orgTimeZone?: string | null;
    folderId?: string;
    limit?: number;
    now?: number;
  },
): Promise<ActionResult<FocusResult>> {
  const limit = args.limit ?? FOCUS_LIMIT;
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", args.userId)
    .maybeSingle();
  const { today, timezoneAssumed } = todayInTimeZone(
    effectiveTimeZone(profile?.timezone, args.orgTimeZone),
    args.now ?? Date.now(),
  );

  const rpcArgs = {
    p_org_id: args.orgId,
    p_today: today,
    p_folder_id: args.folderId ?? null,
    p_stall_days: STALL_DAYS,
    p_limit: limit,
  };

  let v2Rows: V2Row[] | null = null;
  let legacyRows: LegacyRow[] = [];
  const v2 = await (supabase as unknown as FocusV2Rpc).rpc(
    "get_focus_today_v2",
    rpcArgs,
  );
  if (v2.error && !isMissingFunction(v2.error)) return fail(v2.error.message);
  if (!v2.error) {
    const parsed = v2RowSchema.array().safeParse(v2.data ?? []);
    if (!parsed.success)
      return fail("Focus data was not in the expected shape.");
    v2Rows = parsed.data;
  } else {
    const { data, error } = await typedRpc(
      supabase,
      "get_focus_today",
      rpcArgs,
    );
    if (error) return fail(error.message);
    const parsed = legacyRowSchema.array().safeParse(data ?? []);
    if (!parsed.success)
      return fail("Focus data was not in the expected shape.");
    legacyRows = parsed.data;
  }
  const rows: (V2Row | LegacyRow)[] = v2Rows ?? legacyRows;

  let names = new Map<string, string>();
  if (rows.some((r) => r.waiting.length > 0)) {
    try {
      names = nameMap(await listOrgMemberProfiles(supabase, args.orgId));
    } catch {
      // Names are a nicety: the reason still reads without them.
    }
  }

  let totals: Record<FocusTier, number | null>;
  if (v2Rows) {
    // Every row carries every tier's size, counted before the limit.
    const carried = v2Rows[0]?.tier_totals ?? {};
    totals = Object.fromEntries(
      FOCUS_TIERS.map((t) => [t, carried[String(t)] ?? 0]),
    ) as Record<FocusTier, number | null>;
  } else {
    // Rows come in tier order, one tier per item. A tier before the last
    // returned one with no rows is truly empty; one after it is empty only
    // when the list is shorter than the limit, otherwise it was cut off:
    // unknown. Tier 0 does not exist in this function: always unknown.
    const lastTier = legacyRows.at(-1)?.tier ?? 0;
    const full = legacyRows.length >= limit;
    totals = Object.fromEntries(
      FOCUS_TIERS.map((t) => [t, t === 0 || (full && t > lastTier) ? null : 0]),
    ) as Record<FocusTier, number | null>;
    for (const r of legacyRows) totals[r.tier] = r.tier_total;
  }

  const items = rows.map((r): FocusItem => {
    const access = "can_edit" in r ? r : null;
    return {
      itemId: r.item_id,
      itemName: r.item_name,
      boardId: r.board_id,
      boardName: r.board_name,
      groupName: r.group_name,
      status: r.status_label,
      dueDate: r.due_date,
      tier: r.tier,
      reason: focusReason({
        tier: r.tier,
        daysOverdue: r.days_overdue,
        dueInDays: r.due_date ? daysBetween(today, r.due_date) : undefined,
        waitingCount: r.waiting_count,
        waiting: r.waiting.map((w) => ({
          name: w.name,
          assignees: w.assigneeIds
            .filter((id) => id !== args.userId)
            .map((id) => personName(names, id)),
        })),
        unreadCount: r.unread_count,
        daysQuiet: r.days_quiet,
      }),
      canEdit: access?.can_edit ?? false,
      canMarkDone: access?.has_status ?? false,
      canSetDue: access?.has_due ?? false,
    };
  });

  return {
    ok: true,
    data: {
      today,
      timezoneAssumed,
      items,
      totals,
      ordering: v2Rows ? "current" : "legacy",
    },
  };
}
