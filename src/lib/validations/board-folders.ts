import { z } from "zod";

// 60 chars matches the DB CHECK on board_folders.name — keep the two in step.
const name = z.string().trim().min(1).max(60);
const uuid = z.string().uuid();

export const createFolderSchema = z.object({ name });
export const renameFolderSchema = z.object({ folderId: uuid, name });
export const deleteFolderSchema = z.object({ folderId: uuid });
export const moveBoardToFolderSchema = z.object({
  boardId: uuid,
  folderId: uuid.nullable(),
});
