"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { boardFoldersTag } from "@/lib/cache/tags";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { BoardFolder } from "@/lib/boards/folders/types";
import {
  createFolderSchema,
  deleteFolderSchema,
  moveBoardToFolderSchema,
  renameFolderSchema,
} from "@/lib/validations/board-folders";

/**
 * Folders are private to one user, so every action here is scoped by RLS on
 * `user_id = auth.uid()` — that is why these use the request-scoped client, not
 * the service client. Each ends by invalidating ONLY `boardFoldersTag`: no board
 * row changed, so `boardsTag` / `sharedBoardsTag` stay warm.
 */

export async function createFolder(input: {
  name: string;
}): Promise<ActionResult<BoardFolder>> {
  const parsed = createFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const user = await getUser();
  if (!user) return fail("You must be signed in.");

  const supabase = await createClient();

  // Append: one bounded, indexed read of the current highest position.
  const { data: last } = await supabase
    .from("board_folders")
    .select("position")
    .order("position", { ascending: false })
    .limit(1);
  const position = (last?.[0]?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("board_folders")
    .insert({ user_id: user.id, name: parsed.data.name, position })
    .select("id, name, position")
    .single();
  if (error || !data) return fail(error?.message ?? "Couldn't create folder.");

  updateTag(boardFoldersTag(user.id));
  return {
    ok: true,
    data: { id: data.id, name: data.name, position: data.position },
  };
}

export async function renameFolder(input: {
  folderId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const user = await getUser();
  if (!user) return fail("You must be signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("board_folders")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.folderId);
  if (error) return fail(error.message);

  updateTag(boardFoldersTag(user.id));
  return { ok: true, data: undefined };
}

/**
 * Deleting a folder deletes its placements (FK cascade) and nothing else — the
 * boards themselves are untouched and reappear as unfiled. That is why there is
 * no "this cannot be undone" ceremony: nothing destructive happens to a board.
 */
export async function deleteFolder(input: {
  folderId: string;
}): Promise<ActionResult> {
  const parsed = deleteFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const user = await getUser();
  if (!user) return fail("You must be signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("board_folders")
    .delete()
    .eq("id", parsed.data.folderId);
  if (error) return fail(error.message);

  updateTag(boardFoldersTag(user.id));
  return { ok: true, data: undefined };
}

/**
 * File a board into a folder, or unfile it with `folderId: null`. The upsert is
 * on the (user_id, board_id) primary key, so moving between folders is one
 * statement with no read-modify-write race — and the key itself is what makes
 * "at most one folder" impossible to violate.
 */
export async function moveBoardToFolder(input: {
  boardId: string;
  folderId: string | null;
}): Promise<ActionResult> {
  const parsed = moveBoardToFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const user = await getUser();
  if (!user) return fail("You must be signed in.");

  const supabase = await createClient();

  if (parsed.data.folderId === null) {
    const { error } = await supabase
      .from("board_folder_boards")
      .delete()
      .eq("board_id", parsed.data.boardId);
    if (error) return fail(error.message);
  } else {
    const { data: last } = await supabase
      .from("board_folder_boards")
      .select("position")
      .eq("folder_id", parsed.data.folderId)
      .order("position", { ascending: false })
      .limit(1);
    const position = (last?.[0]?.position ?? -1) + 1;

    const { error } = await supabase.from("board_folder_boards").upsert(
      {
        user_id: user.id,
        board_id: parsed.data.boardId,
        folder_id: parsed.data.folderId,
        position,
      },
      { onConflict: "user_id,board_id" },
    );
    // A board you cannot read is rejected by the RLS WITH CHECK, not by code.
    if (error) return fail(error.message);
  }

  updateTag(boardFoldersTag(user.id));
  return { ok: true, data: undefined };
}
