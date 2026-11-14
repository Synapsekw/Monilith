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
import type { Tables } from "@/types/database.types";

/**
 * The created row comes back whole so every add path can put it straight into
 * its client cache: `item_dependencies` is not in the realtime publication, so
 * no echo will ever deliver it.
 */

export async function createDependency(input: {
  predecessorId: string;
  successorId: string;
}): Promise<ActionResult<{ dependency: Tables<"item_dependencies"> }>> {
  const parsed = createDependencySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_item_dependency", {
    p_predecessor: parsed.data.predecessorId,
    p_successor: parsed.data.successorId,
  });
  if (error || !data) return fail(dependencyErrorMessage(error));
  return { ok: true, data: { dependency: data } };
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
  // RLS filters a delete the caller may not make down to 0 rows with no
  // error, so success is "a row came back", not "no error".
  const { data: deleted, error } = await supabase
    .from("item_dependencies")
    .delete()
    .eq("id", parsed.data.dependencyId)
    .select("id");
  if (error) return fail("Couldn't remove the dependency.");
  if (!deleted || deleted.length === 0)
    return fail("You can't remove this dependency.");
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

const editableBoardIdsSchema = z.object({
  boardIds: z.array(z.string().uuid()).min(1).max(25),
});

/**
 * Which of these boards the caller can edit — for the "Blocking" picker, where
 * the picked item is the successor and `create_item_dependency` requires edit
 * on its board. There is no batched editability RPC, and re-implementing
 * `can_edit_board`'s rules here would drift, so this runs one `can_edit_board`
 * per distinct board in parallel inside ONE action call. Bounded to 25 ids
 * (one search page); the client caches answers per board for the session and
 * only asks about boards it hasn't seen. A failed check reads as not editable
 * (the RPC stays the real gate).
 */
export async function editableBoardIds(input: {
  boardIds: string[];
}): Promise<ActionResult<string[]>> {
  const parsed = editableBoardIdsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid boards.");
  const supabase = await createClient();
  const ids = [...new Set(parsed.data.boardIds)];
  const checks = await Promise.all(
    ids.map(async (id) => {
      const { data, error } = await typedRpc(supabase, "can_edit_board", {
        p_board_id: id,
      });
      return !error && data === true ? id : null;
    }),
  );
  return { ok: true, data: checks.filter((id): id is string => id !== null) };
}
