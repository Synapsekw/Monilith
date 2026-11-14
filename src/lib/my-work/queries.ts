import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { getUserTimeZoneCached } from "@/lib/profile/queries-cached";
import { todayInTimeZone } from "@/lib/focus/today";
import { getFocusTodayCore, type FocusResult } from "@/lib/focus/queries";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import {
  bucketMyWork,
  type MyWorkGroup,
  type MyWorkItem,
} from "@/lib/my-work/bucket";

/**
 * Hot-path cap (AGENTS.md: bounded reads over indexed columns). It bounds the
 * whole page and truncates silently AFTER ordering by due date, so what is cut
 * is the latest-due tail — raise alongside pagination if a user ever
 * approaches it (a single person assigned to 500 open items is already far
 * past useful).
 */
export const MY_WORK_ITEM_LIMIT = 500;

/**
 * Client-injected core. Takes the client as a parameter so both the RSC path
 * (cookie-bound) and the MCP path (OAuth-bridged) share ONE implementation —
 * the `upsertCellCore` precedent. The RPC is SECURITY INVOKER, so RLS scopes
 * rows to the caller; `auth.uid()` supplies the user.
 *
 * Open items assigned to the caller in ONE organization, earliest due first
 * (ordered before the limit in SQL), read from the shared `item_facts` view so
 * "open" and "due" mean the same thing here as in every other surface.
 *
 * Returns a discriminated result rather than swallowing RPC errors into `[]`:
 * the MCP path needs to tell a genuine failure apart from "no assigned items"
 * (surfaced as `isError: true` in `getMyWorkHandler`). The cookie-bound
 * `getMyWorkItems()` wrapper below maps `ok: false` back to `[]`.
 */
export async function getMyWorkItemsCore(
  supabase: SupabaseClient<Database>,
  args: { orgId: string; limit?: number },
): Promise<{ ok: true; items: MyWorkItem[] } | { ok: false; error: string }> {
  const { data, error } = await typedRpc(supabase, "get_my_open_work", {
    p_org_id: args.orgId,
    p_limit: args.limit ?? MY_WORK_ITEM_LIMIT,
  });
  if (error) return { ok: false, error: error.message };
  const items = (data ?? []).map((r) => ({
    itemId: r.item_id,
    itemName: r.item_name,
    boardId: r.board_id,
    boardName: r.board_name ?? "Unknown board",
    groupName: r.group_name,
    status:
      r.status_label !== null
        ? { label: r.status_label, color: r.status_color ?? "" }
        : null,
    dueDate: r.due_date,
  }));
  return { ok: true, items };
}

/** Cookie-bound wrapper — the RSC entry point: the active org's open items. */
export async function getMyWorkItems(): Promise<MyWorkItem[]> {
  const user = await getUser();
  if (!user) return [];
  const org = await resolveActiveOrg();
  if (!org) return [];
  const supabase = await createClient();
  const result = await getMyWorkItemsCore(supabase, { orgId: org.id });
  return result.ok ? result.items : [];
}

/**
 * Whether the member's org may use the assistant. The entitlement check only
 * has a throwing form (it is the route's gate), so a throw reads as "no" — the
 * button simply is not offered, and the page never fails over it.
 */
async function aiAvailable(orgId: string): Promise<boolean> {
  try {
    await requireAiEntitlement(orgId, "ask_pulse");
    return true;
  } catch {
    return false;
  }
}

/**
 * Page-level read: the ranked Today list, the assigned items bucketed by due
 * date, and whether to offer "Ask about my day". `today` is the member's own
 * calendar day (profile time zone, UTC when unset) which the list uses to tint
 * overdue rows. The clock and the bucketing live here (a server module) so
 * the RSC page stays a pure render.
 *
 * One round of parallel reads on first paint: the list, the focus query and
 * the entitlement do not wait on each other. A failed focus read degrades to
 * `focus: null` (the block says so) and never takes the list down with it.
 */
export async function getMyWorkPageData(): Promise<{
  today: string;
  groups: MyWorkGroup[];
  focus: FocusResult | null;
  canAsk: boolean;
}> {
  const user = await getUser();
  const org = user ? await resolveActiveOrg() : null;
  const tz = user ? await getUserTimeZoneCached(user.id) : null;
  const { today } = todayInTimeZone(tz, Date.now());
  if (!user || !org) return { today, groups: [], focus: null, canAsk: false };

  const supabase = await createClient();
  const [list, focus, canAsk] = await Promise.all([
    getMyWorkItemsCore(supabase, { orgId: org.id }),
    getFocusTodayCore(supabase, { orgId: org.id, userId: user.id }),
    aiAvailable(org.id),
  ]);
  return {
    today,
    groups: bucketMyWork(list.ok ? list.items : [], today),
    focus: focus.ok ? focus.data : null,
    canAsk,
  };
}
