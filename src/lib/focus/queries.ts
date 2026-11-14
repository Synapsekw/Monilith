import * as z from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { listOrgMemberProfiles } from "@/lib/mcp/org-scope";
import { nameMap, personName } from "@/lib/mcp/tools/names";
import { STALL_DAYS } from "@/lib/boards/intelligence/constants";
import { todayInTimeZone } from "./today";
import { focusReason, type FocusTier } from "./reason";

export const FOCUS_LIMIT = 20;

const rowSchema = z.object({
  item_id: z.string(),
  item_name: z.string(),
  board_id: z.string(),
  board_name: z.string(),
  group_name: z.string().nullable(),
  status_label: z.string().nullable(),
  due_date: z.string().nullable(),
  tier: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  days_overdue: z.number().nullable(),
  waiting_count: z.number(),
  waiting: z.array(
    z.object({
      itemId: z.string(),
      name: z.string(),
      assigneeIds: z.array(z.string()),
    }),
  ),
  unread_count: z.number(),
  days_quiet: z.number().nullable(),
  tier_total: z.number(),
});

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
};

export type FocusResult = {
  today: string;
  timezoneAssumed: boolean;
  items: FocusItem[];
  totals: Record<FocusTier, number>;
};

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );

/**
 * The ranked Today list for `userId`, through the caller's own client. Shared
 * by the My Work page and the `get_focus_today` tool. Ranking is done by the
 * SQL function; this only validates rows and words the reasons.
 */
export async function getFocusTodayCore(
  supabase: SupabaseClient<Database>,
  args: {
    orgId: string;
    userId: string;
    folderId?: string;
    limit?: number;
    now?: number;
  },
): Promise<ActionResult<FocusResult>> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", args.userId)
    .maybeSingle();
  const { today, timezoneAssumed } = todayInTimeZone(
    profile?.timezone ?? null,
    args.now ?? Date.now(),
  );

  const { data, error } = await typedRpc(supabase, "get_focus_today", {
    p_org_id: args.orgId,
    p_today: today,
    p_folder_id: args.folderId ?? null,
    p_stall_days: STALL_DAYS,
    p_limit: args.limit ?? FOCUS_LIMIT,
  });
  if (error) return fail(error.message);

  const parsed = rowSchema.array().safeParse(data ?? []);
  if (!parsed.success) return fail("Focus data was not in the expected shape.");

  let names = new Map<string, string>();
  if (parsed.data.some((r) => r.waiting.length > 0)) {
    try {
      names = nameMap(await listOrgMemberProfiles(supabase, args.orgId));
    } catch {
      // Names are a nicety: the reason still reads without them.
    }
  }

  const totals: Record<FocusTier, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const items = parsed.data.map((r): FocusItem => {
    totals[r.tier] = r.tier_total;
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
    };
  });

  return { ok: true, data: { today, timezoneAssumed, items, totals } };
}
