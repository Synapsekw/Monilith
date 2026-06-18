import { describe, it, expect } from "vitest";
import {
  automationTriggerSchema,
  createAutomationSchema,
} from "@/lib/validations/automations";

const COL = "00000000-0000-4000-8000-000000000001";
const OPT = "00000000-0000-4000-8000-000000000002";

describe("automationTriggerSchema (5b-1 union)", () => {
  it("accepts status_changed", () => {
    expect(
      automationTriggerSchema.safeParse({
        type: "status_changed",
        columnId: COL,
        toOptionId: null,
      }).success,
    ).toBe(true);
  });

  it("accepts item_created with no extra fields", () => {
    expect(
      automationTriggerSchema.safeParse({ type: "item_created" }).success,
    ).toBe(true);
  });

  it("accepts person_assigned with a columnId", () => {
    expect(
      automationTriggerSchema.safeParse({
        type: "person_assigned",
        columnId: COL,
      }).success,
    ).toBe(true);
  });

  it("rejects person_assigned without a columnId", () => {
    expect(
      automationTriggerSchema.safeParse({ type: "person_assigned" }).success,
    ).toBe(false);
  });

  it("rejects an unknown trigger type", () => {
    expect(
      automationTriggerSchema.safeParse({ type: "nope", columnId: COL })
        .success,
    ).toBe(false);
  });
});

describe("createAutomationSchema condition", () => {
  const base = {
    boardId: COL,
    trigger: { type: "item_created" as const },
    actions: [{ type: "set_option" as const, columnId: COL, optionId: OPT }],
  };

  it("accepts an absent condition", () => {
    expect(createAutomationSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a multi-condition AND/OR filter", () => {
    expect(
      createAutomationSchema.safeParse({
        ...base,
        condition: {
          combinator: "or",
          conditions: [{ columnId: COL, operator: "is", value: OPT }],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects an invalid operator in a condition", () => {
    expect(
      createAutomationSchema.safeParse({
        ...base,
        condition: {
          combinator: "and",
          conditions: [{ columnId: COL, operator: "bogus", value: "x" }],
        },
      }).success,
    ).toBe(false);
  });
});
