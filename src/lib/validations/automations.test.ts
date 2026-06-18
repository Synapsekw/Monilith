import { describe, it, expect } from "vitest";
import {
  automationTriggerSchema,
  automationActionsSchema,
  createAutomationSchema,
} from "@/lib/validations/automations";

const UUID = "00000000-0000-4000-8000-000000000001";
const UUID2 = "00000000-0000-4000-8000-000000000002";

describe("automation schemas", () => {
  it("accepts a status_changed trigger (specific + any)", () => {
    expect(
      automationTriggerSchema.safeParse({
        type: "status_changed",
        columnId: UUID,
        toOptionId: "opt-1",
      }).success,
    ).toBe(true);
    expect(
      automationTriggerSchema.safeParse({
        type: "status_changed",
        columnId: UUID,
        toOptionId: null,
      }).success,
    ).toBe(true);
  });

  it("accepts notify(owner/member) and set_option actions", () => {
    const ok = automationActionsSchema.safeParse([
      { type: "notify", recipient: { kind: "owner", peopleColumnId: UUID } },
      { type: "notify", recipient: { kind: "member", userId: UUID2 } },
      { type: "set_option", columnId: UUID, optionId: "opt-9" },
    ]);
    expect(ok.success).toBe(true);
  });

  it("rejects an empty actions array and unknown action types", () => {
    expect(automationActionsSchema.safeParse([]).success).toBe(false);
    expect(
      automationActionsSchema.safeParse([{ type: "delete_item" }]).success,
    ).toBe(false);
  });

  it("requires a valid trigger + non-empty actions for create", () => {
    expect(
      createAutomationSchema.safeParse({
        boardId: UUID,
        trigger: { type: "status_changed", columnId: UUID, toOptionId: null },
        actions: [{ type: "set_option", columnId: UUID2, optionId: "x" }],
      }).success,
    ).toBe(true);
    expect(
      createAutomationSchema.safeParse({
        boardId: UUID,
        trigger: {},
        actions: [],
      }).success,
    ).toBe(false);
  });
});
