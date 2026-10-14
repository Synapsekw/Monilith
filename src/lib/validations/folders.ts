import { z } from "zod";

// 60 chars matches the DB CHECK on folders.name — keep the two in step.
const name = z.string().trim().min(1).max(60);
const uuid = z.string().uuid();

export const folderIdSchema = uuid;
export const createFolderSchema = z.object({ workspaceId: uuid, name });
// workspace_id is intentionally NOT part of this schema (or the rename
// action's input): RLS would allow the update, but moving a folder to a
// different workspace breaks the one-workspace-per-folder invariant.
export const renameFolderSchema = z.object({ folderId: uuid, name });
export const deleteFolderSchema = z.object({ folderId: uuid });
export const moveBoardToFolderSchema = z.object({
  boardId: uuid,
  folderId: uuid.nullable(),
});
export const attachDashboardSchema = z.object({
  dashboardId: uuid,
  folderId: uuid.nullable(),
});
/** A tab id from a folder's layout config. The four preset ids (overview,
 *  stages, boards, people) are the legacy enum values, so old deep links and
 *  any server-side use keep parsing. */
export const commandTabSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
