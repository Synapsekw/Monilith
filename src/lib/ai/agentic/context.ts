import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  buildAutomationContext,
  type AutomationContext,
} from "@/lib/ai/automation-context";
import {
  listVisibleOrgMembers,
  orgMembersForAbsentViewer,
} from "@/lib/org/visible-roster";

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
 *
 * MEMBERS are never the raw org roster. They are the people `viewer` may see
 * (`@/lib/org/visible-roster`), because the model can name any member it is
 * shown (the `notify` action) and a guest must not reach people they share
 * nothing with:
 *   - `session`: the signed-in user previewing a step (cookie-bound RLS).
 *   - `author`: a fired rule, with no session. A full member's rule sees the
 *     org; a guest's rule (or one whose author is gone) sees only its author.
 */
export type JobViewer =
  { kind: "session" } | { kind: "author"; userId: string | null };

export async function buildJobContext(
  svc: SupabaseClient<Database>,
  args: {
    orgId: string;
    boardId: string;
    itemId: string | null;
    viewer: JobViewer;
  },
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
    args.viewer.kind === "session"
      ? listVisibleOrgMembers(args.orgId)
      : orgMembersForAbsentViewer(args.viewer.userId, args.orgId),
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
