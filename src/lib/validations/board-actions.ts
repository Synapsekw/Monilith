import { z } from "zod";

const name = z.string().trim().min(1).max(100);
const itemName = z.string().trim().min(1).max(255);
const uuid = z.string().uuid();

export const createBoardSchema = z.object({ workspaceId: uuid, name });
export const renameBoardSchema = z.object({ boardId: uuid, name });
export const deleteBoardSchema = z.object({ boardId: uuid });
export const createGroupSchema = z.object({ boardId: uuid, name });
export const createItemSchema = z.object({ groupId: uuid, name: itemName });
export const renameItemSchema = z.object({ itemId: uuid, name: itemName });
