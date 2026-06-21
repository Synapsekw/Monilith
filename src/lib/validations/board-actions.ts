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
export const addSubitemSchema = z.object({ parentId: uuid, name: itemName });
export const deleteItemSchema = z.object({ itemId: uuid });
export const reorderItemSchema = z.object({
  itemId: uuid,
  position: z.number(),
});

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
  // Optional initial settings (e.g. a relation column's target board). Validated
  // against the kind's settings schema inside the action.
  settings: z.record(z.string(), z.unknown()).optional(),
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

// Settings validated structurally here; kind-specific shape enforced server-side
// via columnSettingsSchema(kind).
export const updateColumnSettingsSchema = z.object({
  columnId: uuid,
  settings: z.record(z.string(), z.unknown()),
});
export const removeColumnOptionSchema = z.object({
  columnId: uuid,
  optionId: z.string().min(1),
});

// --- time-tracking action schemas ---
export const startTimerSchema = z.object({ itemId: uuid, columnId: uuid });
export const stopTimerSchema = z.object({ entryId: uuid });
export const addManualEntrySchema = z.object({
  itemId: uuid,
  columnId: uuid,
  // local date (YYYY-MM-DD) the session is logged against; defaults today in UI
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSecs: z
    .number()
    .int()
    .positive()
    .max(86_400 * 366),
});
export const editEntrySchema = z.object({
  entryId: uuid,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSecs: z
    .number()
    .int()
    .positive()
    .max(86_400 * 366),
});
export const deleteEntrySchema = z.object({ entryId: uuid });
export const setEstimateSchema = z.object({
  itemId: uuid,
  columnId: uuid,
  estimateSeconds: z.number().int().positive().nullable(),
});
export const setRelationLinksSchema = z.object({
  itemId: uuid,
  columnId: uuid,
  linkedItemIds: z.array(uuid).max(200),
});
