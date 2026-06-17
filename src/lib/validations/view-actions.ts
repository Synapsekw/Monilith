import { z } from "zod";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(100);

export const viewKindSchema = z.enum([
  "table",
  "kanban",
  "calendar",
  "timeline",
]);

// Kanban config: a grouping column id (uuid) or null/absent.
export const kanbanConfigSchema = z.object({
  group_column_id: uuid.nullable().optional(),
});

// Calendar config: the date column id to use (uuid) or null/absent.
export const calendarConfigSchema = z
  .object({
    date_column_id: z.string().uuid().nullable().optional(),
  })
  .strict();

// Timeline config: date column id + optional zoom level.
export const timelineConfigSchema = z.object({
  date_column_id: z.string().uuid().nullable().optional(),
  zoom: z.enum(["week", "month"]).optional(),
});

/** Return the Zod schema for the per-kind config object. */
export function configSchemaForKind(kind: string): z.ZodTypeAny {
  if (kind === "kanban") return kanbanConfigSchema;
  if (kind === "calendar") return calendarConfigSchema;
  if (kind === "timeline") return timelineConfigSchema;
  return z.object({}).strict();
}

export const createBoardViewSchema = z.object({
  boardId: uuid,
  kind: viewKindSchema,
  name: name.optional(),
});

export const updateBoardViewSchema = z.object({
  viewId: uuid,
  name: name.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const deleteBoardViewSchema = z.object({ viewId: uuid });
