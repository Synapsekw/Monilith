import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  buildAutomationContext,
  type AutomationContext,
} from "@/lib/ai/automation-context";
import { listOrgMembersCached } from "@/lib/org/queries-cached";

/**
 * The labels+ids facts the F13 decision loop is allowed to see: the board's
 * columns (with option labels/ids), groups, and org members — plus the triggering
 * item's id + name. Deliberately **no cell values** (E4 privacy parity, spec
 * §11.5): the confined executor matches raw ids, so the model only needs the
 * vocabulary to reference. `buildAutomationContext` enforces the column/group/
 * member projection; the item is title-only.
 */
export type AgenticContext = AutomationContext & {
  item: { id: string; name: string } | null;
};

/**
 * Build the decision context for an `ai_step` job. Runs under a **service-role**
 * client (the endpoint has no user session) — reads are scoped by the explicit
 * `board_id`/`org_id` filters, not RLS. Mirrors the projection discipline of the
 * NL-automation generator (`automation-gen-actions`), so the same egress
 * guarantee holds: labels + ids only, never row data.
 */
export async function buildJobContext(
  svc: SupabaseClient<Database>,
  args: { orgId: string; boardId: string; itemId: string | null },
): Promise<AgenticContext> {
  const [columnsRes, groupsRes, members] = await Promise.all([
    svc
      .from("columns")
      .select("id, name, kind, settings")
      .eq("board_id", args.boardId)
      .order("position", { ascending: true }),
    svc
      .from("groups")
      .select("id, name")
      .eq("board_id", args.boardId)
      .order("position", { ascending: true }),
    listOrgMembersCached(args.orgId),
  ]);

  const base = buildAutomationContext({
    columns: columnsRes.data ?? [],
    groups: groupsRes.data ?? [],
    members,
  });

  let item: AgenticContext["item"] = null;
  if (args.itemId) {
    const { data } = await svc
      .from("items")
      .select("id, name")
      .eq("id", args.itemId)
      .maybeSingle();
    if (data) item = { id: data.id, name: data.name };
  }

  return { ...base, item };
}
