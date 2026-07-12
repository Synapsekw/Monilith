"use server";

import { updateTag } from "next/cache";
import { getUser } from "@/lib/auth/session";
import { boardsTag } from "@/lib/cache/tags";
import { getBoardTrash } from "@/lib/boards/trash-queries";
import { loadBoardTrashSchema } from "@/lib/validations/board-actions";
import type { Tables } from "@/types/database.types";

/**
 * Invalidate the current user's cached `boards:user:<me>` list
 * (read-your-own-writes). Board-list mutations are owner-scoped
 * (`created_by = me`), so the owner is the current session user.
 */
export async function invalidateMyBoards(): Promise<void> {
  const user = await getUser();
  if (user) updateTag(boardsTag(user.id));
}

/**
 * Client-callable wrapper over the `server-only` `getBoardTrash` read. The
 * per-board Trash dialog is a client component and cannot import a `server-only`
 * module directly, so this thin `"use server"` action validates the board id and
 * delegates. `getBoardTrash` already enforces RLS via the server client, so no
 * extra authorization is needed here. Throws on an invalid id (the caller shows
 * an error toast).
 */
export async function loadBoardTrash(boardId: string): Promise<{
  groups: Tables<"groups">[];
  items: Tables<"items">[];
}> {
  const parsed = loadBoardTrashSchema.safeParse({ boardId });
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid board id");
  return getBoardTrash(parsed.data.boardId);
}
