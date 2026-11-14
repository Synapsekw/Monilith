"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import {
  dependencyContextSchema,
  type DependencyContext,
} from "@/lib/boards/timeline-context";
import {
  createDependencySchema,
  deleteDependencySchema,
} from "@/lib/validations/dependency-actions";
import { fail, type ActionResult } from "@/lib/actions/result";
import { dependencyErrorMessage } from "@/lib/boards/dependency-errors";
import { searchItems, type ItemSearchResult } from "@/lib/search/item-search";

export async function createDependency(input: {
  predecessorId: string;
  successorId: string;
}): Promise<ActionResult<{ dependencyId: string }>> {
  const parsed = createDependencySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_item_dependency", {
    p_predecessor: parsed.data.predecessorId,
    p_successor: parsed.data.successorId,
  });
  if (error || !data) return fail(dependencyErrorMessage(error));
  return { ok: true, data: { dependencyId: data.id } };
}

export async function deleteDependency(input: {
  dependencyId: string;
}): Promise<ActionResult> {
  const parsed = deleteDependencySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data: dep, error: readErr } = await supabase
    .from("item_dependencies")
    .select("board_id")
    .eq("id", parsed.data.dependencyId)
    .maybeSingle();
  if (readErr || !dep) return fail("Dependency not found.");
  const { error } = await supabase
    .from("item_dependencies")
    .delete()
    .eq("id", parsed.data.dependencyId);
  if (error) return fail("Couldn't remove the dependency.");
  return { ok: true, data: undefined };
}

/**
 * Foreign ends of this board's cross-board links (their boards' schedule config
 * and the linked items' dates), RLS-scoped. Same-board links need no context.
 */
export async function getBoardDependencyContext(input: {
  boardId: string;
}): Promise<ActionResult<DependencyContext>> {
  const parsed = z.string().uuid().safeParse(input.boardId);
  if (!parsed.success) return fail("Invalid board.");
  const supabase = await createClient();
  const { data, error } = await typedRpc(supabase, "board_dependency_context", {
    p_board_id: parsed.data,
  });
  if (error) return fail("Couldn't load linked items.");
  const ctx = dependencyContextSchema.safeParse(
    data ?? { boards: [], items: [] },
  );
  if (!ctx.success) return fail("Couldn't load linked items.");
  return { ok: true, data: ctx.data };
}

/** A search hit for a new link, plus whether the caller can edit its board. */
export type DependencyTarget = ItemSearchResult & { canEdit: boolean };

/**
 * Org-wide item search for the "Add dependency" picker. Same bounded,
 * RLS-scoped read as the command palette (`searchItems`, max 25 rows), plus
 * one `can_edit_board` check per DISTINCT board in the results, run in
 * parallel — a single client round-trip. Editability matters for "Blocking"
 * links, where the picked item is the successor and the RPC requires edit on
 * its board. A failed check reads as not editable (the RPC stays the gate).
 */
export async function searchDependencyTargets(
  query: string,
): Promise<DependencyTarget[]> {
  const hits = await searchItems(query);
  if (hits.length === 0) return [];
  const supabase = await createClient();
  const boardIds = [...new Set(hits.map((h) => h.boardId))];
  const checks = await Promise.all(
    boardIds.map(async (id) => {
      const { data, error } = await typedRpc(supabase, "can_edit_board", {
        p_board_id: id,
      });
      return [id, !error && data === true] as const;
    }),
  );
  const editable = new Map(checks);
  return hits.map((h) => ({ ...h, canEdit: editable.get(h.boardId) ?? false }));
}
