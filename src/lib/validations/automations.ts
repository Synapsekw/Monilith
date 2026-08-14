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

/**
 * The bounded, REVERSIBLE action vocabulary an `ai_step` may choose from (E5 ·
 * F13 guardrail #2). Deliberately a subset of the manual action union — it
 * EXCLUDES `call_webhook` (irreversible egress) and any destructive shape, so
 * the AI can never invent an action outside this box. The rule author caps it
 * further via `allow` (a non-empty subset of these).
 */
export const AI_STEP_ALLOWED_ACTIONS = [
  "set_option",
  "set_percent",
  "move_to_group",
  "notify",
] as const;
export type AiStepAllowedAction = (typeof AI_STEP_ALLOWED_ACTIONS)[number];

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ai_step"),
    // Bounded free text — flows verbatim into the model prompt at fire time, so
    // an unbounded string is a token/cost-abuse vector.
    instruction: z.string().trim().min(3).max(500),
    // At least one allowed action; each MUST be in the reversible vocabulary.
    // A `call_webhook`/unknown entry fails here (asserted in the schema test).
    allow: z.array(z.enum(AI_STEP_ALLOWED_ACTIONS)).min(1),
  }),
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

/**
 * `AI_STEP_ALLOWED_ACTIONS`, one level up: the actions an AGENT may put in a
 * WHOLE automation it files unattended.
 *
 * The `ai_step` ruling above bounds what a model may choose while a rule FIRES.
 * This one bounds what a model may choose while a rule is CREATED — a distinct
 * and strictly larger blast radius, because a rule fires for everyone on the
 * board, forever, long after the run that filed it ended.
 *
 * `call_webhook` is excluded for the same reason it is excluded there:
 * irreversible egress. The manual path's guard (`_webhook_url_safe` plus the
 * org-admin check in `createAutomationCore`) was written for a HUMAN clicking
 * Save — it blocks SSRF, not a public attacker-controlled host, and the person
 * who sets up agents is very often an org admin. With a model driven by
 * untrusted board text at the wheel, "an admin approved it" stops meaning "a
 * person chose this URL". So the agent-facing tool never even OFFERS the
 * action: it is absent from the schema the model is shown and from the schema
 * that validates its call.
 *
 * The human path is untouched — `createAutomationSchema` still admits
 * `call_webhook`, and `createAutomationCore` (shared by both) still decides it
 * on the org-admin rule. This narrows only the vocabulary the agent is handed.
 */
export const AGENT_FORBIDDEN_AUTOMATION_ACTIONS = ["call_webhook"] as const;

/**
 * Derived from `automationActionSchema.options`, never a hand-copied restatement
 * of the union: a new action type joins the agent's vocabulary automatically,
 * and only an entry in the list above can leave it. That is the same
 * anti-drift property `createAutomationSchema.shape` bought the tool's input
 * schema, kept while narrowing it.
 */
const [firstAgentAction, ...restAgentActions] =
  automationActionSchema.options.filter(
    (option) =>
      !(AGENT_FORBIDDEN_AUTOMATION_ACTIONS as readonly string[]).includes(
        option.shape.type.value,
      ),
  );
// A discriminated union needs at least one member, and destructuring is what
// proves it to the type system without a cast. Unreachable unless the forbidden
// list grows to swallow the whole vocabulary — at which point the tool should be
// removed, not shipped with an empty union.
if (!firstAgentAction)
  throw new Error(
    "AGENT_FORBIDDEN_AUTOMATION_ACTIONS excludes every automation action",
  );

export const agentAutomationActionsSchema = z
  .array(z.discriminatedUnion("type", [firstAgentAction, ...restAgentActions]))
  .min(1);

/** The complement of {@link AGENT_FORBIDDEN_AUTOMATION_ACTIONS}, derived rather
 *  than restated — the action types an agent-filed rule may actually contain. */
export const AGENT_ALLOWED_AUTOMATION_ACTIONS = [
  firstAgentAction,
  ...restAgentActions,
].map((option) => option.shape.type.value);

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

/**
 * What the `create_automation` AGENT TOOL advertises and validates. Identical to
 * `createAutomationSchema` except for the narrowed action union, so the trigger,
 * condition and board fields cannot drift from the human path.
 *
 * `createAutomationCore` deliberately keeps re-parsing with the FULL
 * `createAutomationSchema` — it is shared with the human Save path, where
 * `call_webhook` remains legal for an org admin. This schema is what the model
 * is OFFERED and what its call is checked against; the core stays the authority
 * for the human path and is not weakened by this.
 */
export const agentCreateAutomationSchema = createAutomationSchema.extend({
  actions: agentAutomationActionsSchema,
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
