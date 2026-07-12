import { z } from "zod";

// ISO calendar date (YYYY-MM-DD) — matches dateValueSchema's `date`.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD).");

export const proposedFieldsSchema = z.object({
  ownerUserIds: z.array(z.string()).optional(),
  dueDate: isoDate.optional(),
  endDate: isoDate.optional(),
  statusOptionId: z.string().nullable().optional(),
});
export type ProposedFields = z.infer<typeof proposedFieldsSchema>;

export const proposedActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_item"),
    boardId: z.string(),
    groupId: z.string(),
    name: z.string().min(1).max(255),
    fields: proposedFieldsSchema.optional(),
  }),
  z.object({
    kind: z.literal("set_item_fields"),
    boardId: z.string(),
    itemId: z.string(),
    fields: proposedFieldsSchema,
  }),
  z.object({
    kind: z.literal("create_group"),
    boardId: z.string(),
    name: z.string().min(1).max(255),
  }),
]);
export type ProposedAction = z.infer<typeof proposedActionSchema>;

const validatedExtras = {
  summary: z.string(),
  warnings: z.array(z.string()),
};
export const validatedActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_item"),
    boardId: z.string(),
    groupId: z.string(),
    name: z.string().min(1).max(255),
    fields: proposedFieldsSchema.optional(),
    ...validatedExtras,
  }),
  z.object({
    kind: z.literal("set_item_fields"),
    boardId: z.string(),
    itemId: z.string(),
    fields: proposedFieldsSchema,
    ...validatedExtras,
  }),
  z.object({
    kind: z.literal("create_group"),
    boardId: z.string(),
    name: z.string().min(1).max(255),
    ...validatedExtras,
  }),
]);
export type ValidatedAction = z.infer<typeof validatedActionSchema>;

export type ExecutionResult =
  | { ok: true; itemId?: string }
  | { ok: false; error: string };
