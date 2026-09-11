import { z } from "zod";
import type { SignalKind } from "@/lib/boards/intelligence/types";
import {
  MAX_PAYLOAD_SIGNALS,
  MAX_SUGGESTIONS,
  SIGNAL_KINDS,
} from "@/lib/boards/intelligence/constants";

/* ── What the MODEL returns. Hand-written JSON Schema (house convention:
   REPORT_NARRATIVE_JSON_SCHEMA in src/lib/reports/ai-draft-schema.ts). Every
   action field is REQUIRED and nullable — strict structured output rejects
   optional keys on several providers, and a flat object with a `type`
   discriminator avoids oneOf (src/lib/ai/providers/google.ts:53). ── */
const nullableString = { type: ["string", "null"] } as const;
export const BOARD_INTELLIGENCE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["brief", "suggestions"],
  properties: {
    brief: { type: "string" },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "title",
          "evidence",
          "body",
          "evidenceItemIds",
          "actions",
        ],
        properties: {
          kind: {
            type: "string",
            enum: [
              "overdue",
              "blocked",
              "overloaded",
              "stalled",
              "changed",
              "other",
            ],
          },
          title: { type: "string" },
          evidence: { type: "string" },
          body: { type: "string" },
          evidenceItemIds: { type: "array", items: { type: "string" } },
          actions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "type",
                "itemIds",
                "itemId",
                "columnId",
                "toUserId",
                "date",
                "optionId",
                "userId",
                "message",
                "signalKind",
              ],
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "reassign",
                    "set_due",
                    "set_status",
                    "nudge",
                    "filter",
                  ],
                },
                itemIds: { type: ["array", "null"], items: { type: "string" } },
                itemId: nullableString,
                columnId: nullableString,
                toUserId: nullableString,
                date: nullableString,
                optionId: nullableString,
                userId: nullableString,
                message: nullableString,
                signalKind: nullableString,
              },
            },
          },
        },
      },
    },
  },
} as const;

/* ── Zod for the SAME shape, carrying the length caps the JSON Schema omits.

   Those caps TRUNCATE; they never reject. The model is never told them (the
   schema above carries no lengths), so rejecting on one failed the run AFTER
   the provider call was metered — and a failure leaves the input hash
   unchanged, so every retry regenerated, paid and failed again. Shape stays
   strict: a wrong type or an unknown `kind` is a real provider failure, a
   701-character brief is not. The STORED shapes below (`actionSchema`,
   `suggestionSchema`, `payloadSchema`) are fed only server-built data and stay
   strict — they are the safety net in validate.ts. ── */
const MAX_ACTIONS = 2;
const MAX_EVIDENCE_ITEMS = 8;
const MAX_ACTION_ITEM_IDS = 50;

/** Cut to `max` characters on a word boundary where there is one, marking the
 *  cut with an ellipsis. The result is always `<= max`. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
const cappedString = (max: number) =>
  z.string().transform((t) => truncate(t, max));
const cappedArray = <T extends z.ZodType>(item: T, max: number) =>
  z.array(item).transform((a) => (a.length <= max ? a : a.slice(0, max)));
const suggestionKind = z.enum([
  "overdue",
  "blocked",
  "overloaded",
  "stalled",
  "changed",
  "other",
]);
export type SuggestionKind = z.infer<typeof suggestionKind>;

const rawActionSchema = z.object({
  type: z.enum(["reassign", "set_due", "set_status", "nudge", "filter"]),
  itemIds: cappedArray(z.string(), MAX_ACTION_ITEM_IDS).nullable(),
  itemId: z.string().nullable(),
  columnId: z.string().nullable(),
  toUserId: z.string().nullable(),
  date: z.string().nullable(),
  optionId: z.string().nullable(),
  userId: z.string().nullable(),
  message: cappedString(280).nullable(),
  signalKind: z.string().nullable(),
});
export type RawAction = z.infer<typeof rawActionSchema>;

/** No `min(1)` on `title` or `actions`: a blank title or an empty action list
 *  makes the suggestion USELESS, not the run — validate.ts drops it with a
 *  warning rather than throwing away a brief that was already paid for. */
const rawSuggestionSchema = z.object({
  kind: suggestionKind,
  title: cappedString(80),
  evidence: cappedString(40),
  body: cappedString(240),
  evidenceItemIds: cappedArray(z.string(), MAX_EVIDENCE_ITEMS),
  actions: cappedArray(rawActionSchema, MAX_ACTIONS),
});
export type RawSuggestion = z.infer<typeof rawSuggestionSchema>;

export const rawOutputSchema = z.object({
  brief: cappedString(700),
  suggestions: cappedArray(rawSuggestionSchema, MAX_SUGGESTIONS),
});
export type RawOutput = z.infer<typeof rawOutputSchema>;

/* ── The CLOSED union that may ever be APPLIED (spec §4.4, §7). ── */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const signalKind = z.enum(SIGNAL_KINDS);
const label = z.string().min(1).max(60);
export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reassign"),
    itemIds: z.array(z.string()).min(1).max(50),
    columnId: z.string(),
    toUserId: z.string(),
    label,
  }),
  z.object({
    type: z.literal("set_due"),
    itemId: z.string(),
    columnId: z.string(),
    date: isoDate,
    label,
  }),
  z.object({
    type: z.literal("set_status"),
    itemId: z.string(),
    columnId: z.string(),
    optionId: z.string(),
    label,
  }),
  z.object({
    type: z.literal("nudge"),
    itemId: z.string(),
    userId: z.string(),
    message: z.string().min(1).max(280),
    label,
  }),
  /** `subject` is resolved SERVER-SIDE from the run's signals (the model never
   *  supplies it): an `overloaded` chip filters by person, so without the user
   *  id the provider has nothing to select and the chip is inert. */
  z.object({
    type: z.literal("filter"),
    signalKind,
    subject: z.string().optional(),
    label,
  }),
]);
export type Action = z.infer<typeof actionSchema>;

export const suggestionSchema = z.object({
  id: z.string().min(1).max(8),
  kind: suggestionKind,
  title: z.string().min(1).max(80),
  evidence: z.string().max(40),
  body: z.string().max(240),
  evidenceRows: z
    .array(
      z.object({
        itemId: z.string(),
        name: z.string().max(255),
        detail: z.string().max(120),
      }),
    )
    .max(8),
  actions: z.array(actionSchema).min(1).max(2),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

/** The jsonb we store; parsed again on every read, failing CLOSED (a run row
 *  an older client wrote in another shape is treated as "no run"). */
export const payloadSchema = z.object({
  brief: z.string().max(700),
  suggestions: z.array(suggestionSchema).max(MAX_SUGGESTIONS),
  signals: z
    .array(
      z.object({
        kind: signalKind,
        count: z.number().int().nonnegative(),
        label: z.string().max(80),
      }),
    )
    .max(MAX_PAYLOAD_SIGNALS),
});
export type BoardIntelligencePayload = z.infer<typeof payloadSchema>;
export type { SignalKind };
