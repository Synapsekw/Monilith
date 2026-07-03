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
  z.object({
    type: z.literal("date_reached"),
    columnId: z.string().uuid(),
    offsetDays: z.number().int().min(-365).max(365),
  }),
  z.object({
    type: z.literal("percent_reached"),
    columnId: z.string().uuid(),
    percent: z.number().int().min(1).max(100).default(100),
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
  z.object({
    type: z.literal("set_percent"),
    columnId: z.string().uuid(),
    percent: z.number().int().min(0).max(100),
  }),
  z.object({
    type: z.literal("move_to_group"),
    groupId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("call_webhook"),
    url: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), {
        message: "Webhook URL must use https://",
      }),
    authHeader: z
      .object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9-]+$/, {
            message: "Header name may contain letters, digits, and dashes only",
          }),
        value: z.string().min(1).max(2048),
      })
      .optional(),
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
