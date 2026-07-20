import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  buildAutomationContext,
  type AutomationContext,
} from "@/lib/ai/automation-context";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import type { AutopilotContext } from "./autopilot";

/** Bound on how many items the F14 agent sees per run — keeps the model context
 *  (and token spend) bounded on a large board (spec §6). */
export const AUTOPILOT_ITEM_CAP = 200;

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

/**
 * Build the read context for an F14 Autopilot run. Runs under a **service-role**
 * client (the endpoint has no user session) — reads are scoped by the explicit
 * `board_id`/`org_id` filters, not RLS. Same egress guarantee as `buildJobContext`
 * (labels + ids only, never cell values), but the agent sees the whole board's
 * top-level, non-archived items (title + current group), bounded by
 * {@link AUTOPILOT_ITEM_CAP}, so it can pick WHICH items to keep tidy.
 */
export async function buildAgentContext(
  svc: SupabaseClient<Database>,
  args: { orgId: string; boardId: string },
): Promise<AutopilotContext> {
  const [columnsRes, groupsRes, itemsRes, members] = await Promise.all([
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
    svc
      .from("items")
      .select("id, name, group_id")
      .eq("board_id", args.boardId)
      .is("parent_id", null)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(AUTOPILOT_ITEM_CAP),
    listOrgMembersCached(args.orgId),
  ]);

  const base = buildAutomationContext({
    columns: columnsRes.data ?? [],
    groups: groupsRes.data ?? [],
    members,
  });

  return {
    ...base,
    boardId: args.boardId,
    items: (itemsRes.data ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      groupId: i.group_id,
    })),
  };
}
