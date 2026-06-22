import { describe, it, expect } from "vitest";
import {
  automationTriggerSchema,
  createAutomationSchema,
  automationActionSchema,
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

describe("date_reached trigger", () => {
  it("accepts a valid date_reached trigger", () => {
    const r = automationTriggerSchema.safeParse({
      type: "date_reached",
      columnId: COL,
      offsetDays: -3,
    });
    expect(r.success).toBe(true);
  });

  it("accepts offset 0 (on the date)", () => {
    const r = automationTriggerSchema.safeParse({
      type: "date_reached",
      columnId: COL,
      offsetDays: 0,
    });
    expect(r.success).toBe(true);
  });

  it("rejects offsetDays out of range", () => {
    const r = automationTriggerSchema.safeParse({
      type: "date_reached",
      columnId: COL,
      offsetDays: 9999,
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-integer offsetDays", () => {
    const r = automationTriggerSchema.safeParse({
      type: "date_reached",
      columnId: COL,
      offsetDays: 1.5,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing columnId", () => {
    const r = automationTriggerSchema.safeParse({
      type: "date_reached",
      offsetDays: 0,
    });
    expect(r.success).toBe(false);
  });
});

describe("call_webhook action", () => {
  it("accepts an https url with no auth header", () => {
    const r = automationActionSchema.safeParse({
      type: "call_webhook",
      url: "https://hooks.example.com/abc",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an optional auth header", () => {
    const r = automationActionSchema.safeParse({
      type: "call_webhook",
      url: "https://hooks.example.com/abc",
      authHeader: { name: "Authorization", value: "Bearer xyz" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-https url", () => {
    const r = automationActionSchema.safeParse({
      type: "call_webhook",
      url: "http://hooks.example.com/abc",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an auth header name with illegal characters", () => {
    const r = automationActionSchema.safeParse({
      type: "call_webhook",
      url: "https://hooks.example.com/abc",
      authHeader: { name: "Bad Header!", value: "x" },
    });
    expect(r.success).toBe(false);
  });
});

describe("move_to_group action", () => {
  const GROUP = "00000000-0000-4000-8000-000000000003";

  it("accepts a valid groupId", () => {
    const r = automationActionSchema.safeParse({
      type: "move_to_group",
      groupId: GROUP,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a missing groupId", () => {
    const r = automationActionSchema.safeParse({ type: "move_to_group" });
    expect(r.success).toBe(false);
  });

  it("rejects a non-uuid groupId", () => {
    const r = automationActionSchema.safeParse({
      type: "move_to_group",
      groupId: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });
});
