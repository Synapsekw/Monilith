import * as z from "zod";
import { KPI_ITEM_KINDS } from "@/lib/folders/types";

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
  // Set by the confirm step when the target folder has members (the move
  // gives those people access to the board).
  confirmShared: z.boolean().optional(),
});
export const attachDashboardSchema = z.object({
  dashboardId: uuid,
  folderId: uuid.nullable(),
});
/** The board / stage scope and page of an on-demand folder read. A stage key
 *  is `trim(lower(group name))`; group names are short, 200 is generous. */
const folderPage = {
  folderId: uuid,
  boardId: uuid.nullable().optional(),
  stageKey: z.string().max(200).nullable().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(1_000_000).optional(),
};
export const folderAttentionPageSchema = z.object(folderPage);
export const folderKpiItemsSchema = z.object({
  ...folderPage,
  kpi: z.enum(KPI_ITEM_KINDS),
});
/** A tab id from a folder's layout config. The four preset ids (overview,
 *  stages, boards, people) are the legacy enum values, so old deep links and
 *  any server-side use keep parsing. */
export const commandTabSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
