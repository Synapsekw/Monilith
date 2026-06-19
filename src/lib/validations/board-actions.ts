import { z } from "zod";

import { columnKindSchema } from "@/lib/validations/boards";

const name = z.string().trim().min(1).max(100);
const itemName = z.string().trim().min(1).max(255);
const uuid = z.string().uuid();

export const createBoardSchema = z.object({ workspaceId: uuid, name });
export const createBoardFromTemplateSchema = z.object({
  workspaceId: uuid,
  templateId: z.string().min(1),
  name,
});
export const renameBoardSchema = z.object({ boardId: uuid, name });
export const deleteBoardSchema = z.object({ boardId: uuid });
export const createGroupSchema = z.object({ boardId: uuid, name });
export const renameGroupSchema = z.object({ groupId: uuid, name });
export const deleteGroupSchema = z.object({ groupId: uuid });
export const reorderGroupSchema = z.object({
  groupId: uuid,
  position: z.number(),
});
export const updateGroupColorSchema = z.object({
  groupId: uuid,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid color"),
});
export const createItemSchema = z.object({ groupId: uuid, name: itemName });
export const renameItemSchema = z.object({ itemId: uuid, name: itemName });

// Cell value is validated structurally here (must be a JSON object); the
// kind-specific shape is enforced server-side with cellValueSchema(kind).
const cellValue = z.record(z.string(), z.unknown());

export const upsertCellSchema = z.object({
  itemId: uuid,
  columnId: uuid,
  value: cellValue,
});
export const clearCellSchema = z.object({ itemId: uuid, columnId: uuid });

export const createColumnSchema = z.object({
  boardId: uuid,
  kind: columnKindSchema,
  name: name.optional(),
});
export const renameColumnSchema = z.object({ columnId: uuid, name });
export const deleteColumnSchema = z.object({ columnId: uuid });
export const resizeColumnSchema = z.object({
  columnId: uuid,
  width: z.number().int().min(80).max(1200),
});
// The built-in Name column persists per-board. NULL = auto-fit (client measures
// the longest item name); an integer is a user-dragged width.
export const resizeNameColumnSchema = z.object({
  boardId: uuid,
  width: z.number().int().min(80).max(1200).nullable(),
});
