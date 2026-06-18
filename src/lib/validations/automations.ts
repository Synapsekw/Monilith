import { z } from "zod";
import { listFilterSchema } from "@/lib/validations/dashboards";

export const automationTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status_changed"),
    columnId: z.string().uuid(),
    toOptionId: z.string().min(1).nullable(),
  }),
  z.object({
    type: z.literal("item_created"),
  }),
  z.object({
    type: z.literal("person_assigned"),
    columnId: z.string().uuid(),
  }),
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

const notifyRecipientSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("owner"), peopleColumnId: z.string().uuid() }),
  z.object({ kind: z.literal("member"), userId: z.string().uuid() }),
]);

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("notify"), recipient: notifyRecipientSchema }),
  z.object({
    type: z.literal("set_option"),
    columnId: z.string().uuid(),
    optionId: z.string().min(1),
  }),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const automationActionsSchema = z.array(automationActionSchema).min(1);

/** The optional "If" gate — reuses the dashboards D3b filter shape. */
export const automationConditionSchema = listFilterSchema;
export type AutomationCondition = z.infer<typeof automationConditionSchema>;

export const createAutomationSchema = z.object({
  boardId: z.string().uuid(),
  name: z.string().trim().max(120).optional(),
  trigger: automationTriggerSchema,
  actions: automationActionsSchema,
  condition: automationConditionSchema.nullish(),
});

export const updateAutomationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().max(120).optional(),
  enabled: z.boolean().optional(),
  trigger: automationTriggerSchema.optional(),
  actions: automationActionsSchema.optional(),
  condition: automationConditionSchema.nullish(),
});

export const deleteAutomationSchema = z.object({ id: z.string().uuid() });
