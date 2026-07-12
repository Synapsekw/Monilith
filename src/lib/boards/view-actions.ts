"use server";

import { createClient } from "@/lib/supabase/server";
import {
  createBoardViewSchema,
  deleteBoardViewSchema,
  configSchemaForKind,
  updateBoardViewSchema,
} from "@/lib/validations/view-actions";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { Json, TablesUpdate } from "@/types/database.types";

const DEFAULT_NAME: Record<string, string> = {
  table: "Main Table",
  kanban: "Kanban",
  calendar: "Calendar",
  timeline: "Timeline",
};

export async function createBoardView(input: {
  boardId: string;
  kind: "table" | "kanban" | "calendar" | "timeline";
  name?: string;
}): Promise<ActionResult<{ viewId: string }>> {
  const parsed = createBoardViewSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_board_view", {
    p_board_id: parsed.data.boardId,
    p_kind: parsed.data.kind,
    p_name: parsed.data.name ?? DEFAULT_NAME[parsed.data.kind],
    p_config: {},
  });
  if (error || !data) return fail(error?.message ?? "Could not create view.");

  return { ok: true, data: { viewId: data.id } };
}

export async function updateBoardView(input: {
  viewId: string;
  name?: string;
  config?: Record<string, unknown>;
}): Promise<ActionResult> {
  const parsed = updateBoardViewSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  if (parsed.data.name === undefined && parsed.data.config === undefined)
    return { ok: true, data: undefined };

  const supabase = await createClient();

  // Load the view's kind so config can be validated per-kind, and reuse
  // board_id for the targeted revalidate.
  const { data: view, error: viewErr } = await supabase
    .from("board_views")
    .select("kind, board_id")
    .eq("id", parsed.data.viewId)
    .maybeSingle();
  if (viewErr) return fail(viewErr.message);
  if (!view) return fail("View not found.");

  const patch: TablesUpdate<"board_views"> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.config !== undefined) {
    // Validate config against the per-kind schema.
    const kindSchema = configSchemaForKind(view.kind);
    const cfg = kindSchema.safeParse(parsed.data.config);
    if (!cfg.success) return fail(cfg.error.issues[0]?.message ?? "Invalid");
    patch.config = cfg.data as Json;
  }

  const { error } = await supabase
    .from("board_views")
    .update(patch)
    .eq("id", parsed.data.viewId);
  if (error) return fail(error.message);

  return { ok: true, data: undefined };
}

export async function deleteBoardView(input: {
  viewId: string;
}): Promise<ActionResult> {
  const parsed = deleteBoardViewSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  // The "board keeps >=1 view" invariant is enforced transactionally in the
  // delete_board_view RPC (locks the board's view rows so concurrent deletes
  // serialize). It raises 'a board must keep at least one view' when violated.
  const { error } = await supabase.rpc("delete_board_view", {
    p_view_id: parsed.data.viewId,
  });
  if (error) return fail(error.message);

  // No revalidation: the board client hydrates once and never refetches the RSC;
  // ViewSwitcher drives its own router.refresh()/push() after this resolves.
  return { ok: true, data: undefined };
}
