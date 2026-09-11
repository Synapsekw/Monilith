import { z } from "zod";
import type { SignalKind } from "@/lib/boards/intelligence/types";
import {
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

/* ── Zod for the SAME shape, carrying the length caps the JSON Schema omits. ── */
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
  itemIds: z.array(z.string()).max(50).nullable(),
  itemId: z.string().nullable(),
  columnId: z.string().nullable(),
  toUserId: z.string().nullable(),
  date: z.string().nullable(),
  optionId: z.string().nullable(),
  userId: z.string().nullable(),
  message: z.string().max(280).nullable(),
  signalKind: z.string().nullable(),
});
export type RawAction = z.infer<typeof rawActionSchema>;

const rawSuggestionSchema = z.object({
  kind: suggestionKind,
  title: z.string().min(1).max(80),
  evidence: z.string().max(40),
  body: z.string().max(240),
  evidenceItemIds: z.array(z.string()).max(8),
  actions: z.array(rawActionSchema).min(1).max(2),
});
export type RawSuggestion = z.infer<typeof rawSuggestionSchema>;

export const rawOutputSchema = z.object({
  brief: z.string().min(1).max(700),
  suggestions: z.array(rawSuggestionSchema).max(MAX_SUGGESTIONS),
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
  z.object({ type: z.literal("filter"), signalKind, label }),
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
    .max(10),
});
export type BoardIntelligencePayload = z.infer<typeof payloadSchema>;
export type { SignalKind };
