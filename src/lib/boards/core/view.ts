import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { configSchemaForKind } from "@/lib/validations/view-actions";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { Database, Json, TablesUpdate } from "@/types/database.types";

/** Not exported: only `createBoardViewCore` needs the per-kind default, and
 *  keeping it private avoids a second source of truth appearing elsewhere. */
const DEFAULT_NAME: Record<string, string> = {
  table: "Main Table",
  kanban: "Kanban",
  calendar: "Calendar",
  timeline: "Timeline",
};

export type CreateBoardViewCoreInput = {
  boardId: string;
  kind: "table" | "kanban" | "calendar" | "timeline";
  name?: string;
};

export type UpdateBoardViewCoreInput = {
  viewId: string;
  name?: string;
  config?: Record<string, unknown>;
};

export type DeleteBoardViewCoreInput = { viewId: string };

/**
 * The single implementation of "create one board view" for both callers: the
 * cookie-bound `createBoardView` Server Action (`./view-actions.ts`, which
 * keeps its own Zod parse and has no revalidation step to add) and the
 * `manage_view` MCP tool (`@/lib/mcp/tools/manage-view`). Structural
 * validation (uuid shape, string bounds) is each transport's job — the
 * Server Action's schema, the MCP tool's `inputSchema` — so this core takes
 * an already-shaped input and owns only the business rule: the per-kind
 * default name.
 */
export async function createBoardViewCore(
  supabase: SupabaseClient<Database>,
  input: CreateBoardViewCoreInput,
): Promise<ActionResult<{ viewId: string }>> {
  const { data, error } = await supabase.rpc("create_board_view", {
    p_board_id: input.boardId,
    p_kind: input.kind,
    p_name: input.name ?? DEFAULT_NAME[input.kind],
    p_config: {},
  });
  if (error || !data) return fail(error?.message ?? "Could not create view.");

  return { ok: true, data: { viewId: data.id } };
}

/**
 * The single implementation of "update one board view". Keeps two rules that
 * must survive any future refactor: `config` is validated against the VIEW'S
 * OWN `kind` (a kanban `group_column_id` is nonsense on a table view), and
 * supplying neither `name` nor `config` is a no-op success rather than an
 * error — reads addressed at a view do not need to know its current field
 * values first.
 */
export async function updateBoardViewCore(
  supabase: SupabaseClient<Database>,
  input: UpdateBoardViewCoreInput,
): Promise<ActionResult> {
  if (input.name === undefined && input.config === undefined)
    return { ok: true, data: undefined };

  // Load the view's kind so config can be validated per-kind, and reuse
  // board_id for the targeted revalidate (the Server Action caller only).
  const { data: view, error: viewErr } = await supabase
    .from("board_views")
    .select("kind, board_id")
    .eq("id", input.viewId)
    .maybeSingle();
  if (viewErr) return fail(viewErr.message);
  if (!view) return fail("View not found.");

  const patch: TablesUpdate<"board_views"> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.config !== undefined) {
    // Validate config against the per-kind schema.
    const kindSchema = configSchemaForKind(view.kind);
    const cfg = kindSchema.safeParse(input.config);
    if (!cfg.success) return fail(cfg.error.issues[0]?.message ?? "Invalid");
    patch.config = cfg.data as Json;
  }

  const { error } = await supabase
    .from("board_views")
    .update(patch)
    .eq("id", input.viewId);
  if (error) return fail(error.message);

  return { ok: true, data: undefined };
}

/**
 * The single implementation of "delete one board view". The "board keeps
 * >=1 view" invariant is enforced transactionally in the `delete_board_view`
 * RPC (locks the board's view rows so concurrent deletes serialize); it
 * raises `'a board must keep at least one view'` when violated.
 */
export async function deleteBoardViewCore(
  supabase: SupabaseClient<Database>,
  input: DeleteBoardViewCoreInput,
): Promise<ActionResult> {
  const { error } = await supabase.rpc("delete_board_view", {
    p_view_id: input.viewId,
  });
  if (error) return fail(error.message);

  return { ok: true, data: undefined };
}
