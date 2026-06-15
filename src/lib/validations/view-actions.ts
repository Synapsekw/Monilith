import { z } from "zod";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(100);

export const viewKindSchema = z.enum(["table", "kanban"]);

// Kanban config: a grouping column id (uuid) or null/absent.
export const kanbanConfigSchema = z.object({
  group_column_id: uuid.nullable().optional(),
});

export const createBoardViewSchema = z.object({
  boardId: uuid,
  kind: viewKindSchema,
  name: name.optional(),
});

export const updateBoardViewSchema = z.object({
  viewId: uuid,
  name: name.optional(),
  config: kanbanConfigSchema.optional(),
});

export const deleteBoardViewSchema = z.object({ viewId: uuid });
