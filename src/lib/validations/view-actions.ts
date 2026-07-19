import { z } from "zod";
import { CREATED_AT_SOURCE, UPDATED_AT_SOURCE } from "@/lib/boards/dates";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(100);

// A timeline start/end source: a real date column (uuid) OR an item-timestamp
// sentinel (Created at / Updated at) offered in the pickers.
const dateSourceId = z.union([
  z.string().uuid(),
  z.literal(CREATED_AT_SOURCE),
  z.literal(UPDATED_AT_SOURCE),
]);

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

// Timeline config: start date column id, optional end date column id,
// optional color-by column id (status/dropdown), and optional zoom level.
export const timelineConfigSchema = z.object({
  date_column_id: dateSourceId.nullable().optional(),
  end_column_id: dateSourceId.nullable().optional(),
  color_column_id: z.string().uuid().nullable().optional(),
  zoom: z.enum(["week", "month", "quarter", "year"]).optional(),
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
