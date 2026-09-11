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

  it("parses a raw output and caps lengths", () => {
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
    const tooLong = rawOutputSchema.safeParse({
      brief: "x".repeat(701),
      suggestions: [],
    });
    expect(tooLong.success).toBe(false);
    const six = rawOutputSchema.safeParse({
      brief: "b",
      suggestions: Array.from({ length: 6 }, () => ({
        kind: "other",
        title: "t",
        evidence: "e",
        body: "b",
        evidenceItemIds: [],
        actions: [rawAction()],
      })),
    });
    expect(six.success).toBe(false);
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
