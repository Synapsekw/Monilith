import { describe, expect, it } from "vitest";
import {
  BOARD_INTELLIGENCE_JSON_SCHEMA,
  actionSchema,
  payloadSchema,
  rawOutputSchema,
} from "./schema";

const rawAction = (over: Partial<Record<string, unknown>> = {}) => ({
  type: "filter",
  itemIds: null,
  itemId: null,
  columnId: null,
  toUserId: null,
  date: null,
  optionId: null,
  userId: null,
  message: null,
  signalKind: "overdue",
  ...over,
});

describe("board intelligence schemas", () => {
  it("the model-facing JSON schema requires every action field (strict structured output)", () => {
    const s = BOARD_INTELLIGENCE_JSON_SCHEMA as {
      properties: {
        suggestions: {
          items: {
            properties: {
              actions: {
                items: {
                  required: readonly string[];
                  additionalProperties: boolean;
                };
              };
            };
          };
        };
      };
    };
    const action = s.properties.suggestions.items.properties.actions.items;
    expect(action.additionalProperties).toBe(false);
    expect(action.required).toEqual([
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
    ]);
  });

  it("parses a raw output", () => {
    const ok = rawOutputSchema.safeParse({
      brief: "Three items slipped this week.",
      suggestions: [
        {
          kind: "overdue",
          title: "Push the launch",
          evidence: "3 overdue",
          body: "b",
          evidenceItemIds: ["i1"],
          actions: [rawAction()],
        },
      ],
    });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.brief).toBe("Three items slipped this week.");
  });

  /* The model is never told these caps (the JSON schema carries no lengths), so
     rejecting on one failed the run AFTER the call was metered — and the input
     hash is unchanged, so every retry paid again and failed again. */
  it("truncates over-long output instead of rejecting it", () => {
    const parsed = rawOutputSchema.safeParse({
      brief: `${"word ".repeat(200)}end`,
      suggestions: Array.from({ length: 7 }, () => ({
        kind: "other",
        title: "T".repeat(200),
        evidence: "E".repeat(100),
        body: "B".repeat(500),
        evidenceItemIds: Array.from({ length: 12 }, (_, i) => `i${i}`),
        actions: [
          rawAction(),
          rawAction({ type: "nudge", message: "m".repeat(400) }),
          rawAction(),
        ],
      })),
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.brief.length).toBeLessThanOrEqual(700);
    expect(parsed.data.suggestions).toHaveLength(5);
    const s = parsed.data.suggestions[0];
    expect(s.title.length).toBeLessThanOrEqual(80);
    expect(s.evidence.length).toBeLessThanOrEqual(40);
    expect(s.body.length).toBeLessThanOrEqual(240);
    expect(s.evidenceItemIds).toHaveLength(8);
    expect(s.actions).toHaveLength(2);
    expect(s.actions[1].message?.length).toBeLessThanOrEqual(280);
  });

  it("keeps a suggestion the model returned with no actions (validate drops it)", () => {
    const parsed = rawOutputSchema.safeParse({
      brief: "b",
      suggestions: [
        {
          kind: "other",
          title: "t",
          evidence: "e",
          body: "b",
          evidenceItemIds: [],
          actions: [],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("still rejects a wrong SHAPE — a bad kind, a missing key, a wrong type", () => {
    const badKind = rawOutputSchema.safeParse({
      brief: "b",
      suggestions: [
        {
          kind: "urgent",
          title: "t",
          evidence: "e",
          body: "b",
          evidenceItemIds: [],
          actions: [rawAction()],
        },
      ],
    });
    expect(badKind.success).toBe(false);
    expect(rawOutputSchema.safeParse({ suggestions: [] }).success).toBe(false);
    expect(
      rawOutputSchema.safeParse({ brief: 7, suggestions: [] }).success,
    ).toBe(false);
  });

  it("rejects an unknown action type in the closed union", () => {
    expect(
      actionSchema.safeParse({ type: "delete_item", itemId: "i", label: "x" })
        .success,
    ).toBe(false);
    expect(
      actionSchema.safeParse({
        type: "set_due",
        itemId: "i",
        columnId: "c",
        date: "2026-09-12",
        label: "Set due 12 Sep",
      }).success,
    ).toBe(true);
    expect(
      actionSchema.safeParse({
        type: "set_due",
        itemId: "i",
        columnId: "c",
        date: "12/09/2026",
        label: "x",
      }).success,
    ).toBe(false);
  });

  it("stored payload parse fails closed on a malformed row", () => {
    expect(payloadSchema.safeParse({ brief: "b" }).success).toBe(false);
    expect(
      payloadSchema.safeParse({ brief: "b", suggestions: [], signals: [] })
        .success,
    ).toBe(true);
  });
});
