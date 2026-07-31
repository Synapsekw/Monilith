import { z } from "zod";

export const goalProgressMode = z.enum([
  "manual_number",
  "manual_percent",
  "auto_subgoals",
  "auto_boards",
]);
export const goalStatus = z.enum(["on_track", "at_risk", "off_track", "done"]);

const name = z.string().trim().min(1, "Name is required").max(200);
const percent = z.number().min(0).max(100);
const uuid = z.string().uuid();

export const createGoalSchema = z.object({
  name,
  progressMode: goalProgressMode,
  ownerId: uuid.optional(),
  parentGoalId: uuid.nullable().optional(),
  workspaceId: uuid.nullable().optional(),
  status: goalStatus.optional(),
  startValue: z.number().nullable().optional(),
  currentValue: z.number().nullable().optional(),
  targetValue: z.number().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  percent: percent.nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

export const updateGoalSchema = z.object({
  goalId: uuid,
  name: name.optional(),
  description: z.string().max(2000).nullable().optional(),
  ownerId: uuid.optional(),
  parentGoalId: uuid.nullable().optional(),
  workspaceId: uuid.nullable().optional(),
  progressMode: goalProgressMode.optional(),
  status: goalStatus.optional(),
  startValue: z.number().nullable().optional(),
  currentValue: z.number().nullable().optional(),
  targetValue: z.number().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  percent: percent.nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

export const reorderGoalSchema = z.object({
  goalId: uuid,
  position: z.number(),
});
export const deleteGoalSchema = z.object({ goalId: uuid });

export const setGoalLinksSchema = z.object({
  goalId: uuid,
  links: z
    .array(
      z.object({
        boardId: uuid,
        doneColumnId: uuid.nullable(),
        doneOptionIds: z.array(uuid),
      }),
    )
    .max(200),
});
