import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

// ISO calendar date (YYYY-MM-DD) — matches dateValueSchema's `date`.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD).");

const proposedFieldsSchema = z.object({
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

/** Result of running ONE approved action. A Zod schema (not just a type)
 *  because it is persisted into `ai_messages.tool_trace` and read back from
 *  untyped jsonb. */
export const executionResultSchema = z.union([
  z.object({ ok: z.literal(true), itemId: z.string().optional() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ExecutionResult = z.infer<typeof executionResultSchema>;

/**
 * A single turn in a threaded ⌘K action conversation — structurally an
 * Anthropic `MessageParam`. We forward it back to the model verbatim, so this
 * guard is a shape gate (role + content-is-string-or-array), not a deep
 * validation of every content block. The client holds it opaquely between turns.
 */
const aiConversationTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(z.unknown())]),
});
export const aiConversationHistorySchema = z.array(aiConversationTurnSchema);
export type AiConversationTurn = Anthropic.MessageParam;
