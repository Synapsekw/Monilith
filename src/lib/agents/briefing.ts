import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  bucketMyWork,
  type MyWorkItem,
  type MyWorkGroup,
} from "@/lib/my-work/bucket";
import { MY_WORK_ITEM_LIMIT } from "@/lib/my-work/queries";
import type { BoardScope } from "./agent-config";

/**
 * Builds the daily briefing payload for one agent.
 *
 * The `client` MUST be the owner-scoped client from `owner-client.ts` — the
 * `get_my_work_items` RPC is SECURITY INVOKER, so RLS filters it to exactly
 * what the owner can read. Passing a service client here would silently widen
 * the agent's vision to the whole database; that is the failure mode this whole
 * module exists to make impossible.
 *
 * Note we deliberately reuse `bucketMyWork` rather than inventing sections, so
 * the email and the /my-work page can never disagree about what "overdue" means.
 */

export type Briefing = {
  today: string;
  totals: { overdue: number; today: number; week: number };
  groups: MyWorkGroup[];
};

/** Narrow the owner's assigned items to the agent's configured boards. */
export function applyBoardScope(
  items: MyWorkItem[],
  scope: BoardScope,
): MyWorkItem[] {
  if (scope.mode === "all") return items;
  const allowed = new Set(scope.boardIds);
  return items.filter((i) => allowed.has(i.boardId));
}

export async function buildBriefing(
  client: SupabaseClient<Database>,
  scope: BoardScope,
  todayIso: string,
): Promise<Briefing> {
  const { data, error } = await client.rpc("get_my_work_items", {
    p_limit: MY_WORK_ITEM_LIMIT,
  });
  if (error) throw new Error(`buildBriefing: ${error.message}`);

  const items: MyWorkItem[] = (data ?? []).map((r) => ({
    itemId: r.item_id,
    itemName: r.item_name,
    boardId: r.board_id,
    boardName: r.board_name ?? "Unknown board",
    groupName: r.group_name,
    status: null, // the email renders no status pill; skip option resolution
    dueDate: r.due_date,
  }));

  const groups = bucketMyWork(applyBoardScope(items, scope), todayIso);
  const countOf = (bucket: string) =>
    groups.find((g) => g.bucket === bucket)?.items.length ?? 0;

  return {
    today: todayIso,
    totals: {
      overdue: countOf("overdue"),
      today: countOf("today"),
      week: countOf("week"),
    },
    groups,
  };
}
