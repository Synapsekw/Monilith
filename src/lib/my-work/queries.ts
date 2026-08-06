import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { optionSchema, type ColumnOption } from "@/lib/validations/boards";
import { serverToday } from "@/lib/portfolios/rollup";
import {
  bucketMyWork,
  type MyWorkGroup,
  type MyWorkItem,
  type MyWorkStatus,
} from "@/lib/my-work/bucket";

/**
 * Hot-path caps (AGENTS.md: bounded reads over indexed columns). The item cap
 * bounds the whole page; the column cap bounds the people-column pre-filter.
 * Both truncate silently — raise alongside pagination if a user ever approaches
 * them (a single person assigned to 500 open items is already far past useful).
 */
export const MY_WORK_ITEM_LIMIT = 500;
export const MY_WORK_COLUMN_LIMIT = 2000;

function parseOptions(settings: unknown): ColumnOption[] {
  const raw = (settings as { options?: unknown } | null)?.options ?? [];
  return optionSchema.array().safeParse(raw).data ?? [];
}

/**
 * Client-injected core. Takes the client as a parameter so both the RSC path
 * (cookie-bound) and the MCP path (OAuth-bridged) share ONE implementation —
 * the `upsertCellCore` precedent. The RPC is SECURITY INVOKER, so RLS scopes
 * rows to the caller and no userId/orgId argument is needed.
 *
 * Every item assigned to the current user across every board they can read,
 * enriched with board name, group, status and due date — in ONE round-trip.
 * The four serial TypeScript phases now live in public.get_my_work_items
 * (SECURITY INVOKER — every table still RLS-filtered by the caller; see the
 * migration). Status-option resolution stays here, behind the Zod optionSchema
 * boundary, from the raw settings jsonb the RPC returns per row.
 *
 * Returns a discriminated result rather than swallowing RPC errors into `[]`:
 * the MCP path needs to tell a genuine failure apart from "no assigned items"
 * (surfaced as `isError: true` in `getMyWorkHandler`). The cookie-bound
 * `getMyWorkItems()` wrapper below maps `ok: false` back to `[]` so `/my-work`
 * behaviour is unchanged.
 */
export async function getMyWorkItemsCore(
  supabase: SupabaseClient<Database>,
  limit: number = MY_WORK_ITEM_LIMIT,
): Promise<{ ok: true; items: MyWorkItem[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("get_my_work_items", {
    p_limit: limit,
  });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, items: [] };

  const items = data.map((r) => {
    let status: MyWorkStatus | null = null;
    if (r.status_option_id && r.status_settings) {
      const opt = parseOptions(r.status_settings).find(
        (o) => o.id === r.status_option_id,
      );
      if (opt) status = { label: opt.label, color: opt.color };
    }
    return {
      itemId: r.item_id,
      itemName: r.item_name,
      boardId: r.board_id,
      boardName: r.board_name ?? "Unknown board",
      groupName: r.group_name,
      status,
      dueDate: r.due_date,
    };
  });
  return { ok: true, items };
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged. */
export async function getMyWorkItems(): Promise<MyWorkItem[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const result = await getMyWorkItemsCore(supabase);
  return result.ok ? result.items : [];
}

/**
 * Page-level read: the assigned items, bucketed by due date, plus the server
 * clock the UI uses to tint overdue rows. `Date.now()` and the bucketing live
 * here (a server module) so the RSC page stays a pure render — mirrors how
 * workload/goals compute their clock inside the query layer.
 */
export async function getMyWorkPageData(): Promise<{
  today: string;
  groups: MyWorkGroup[];
}> {
  const today = serverToday(Date.now());
  const items = await getMyWorkItems();
  return { today, groups: bucketMyWork(items, today) };
}
