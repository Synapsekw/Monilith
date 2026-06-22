import { describe, expect, it } from "vitest";
import {
  createGoalSchema,
  updateGoalSchema,
  setGoalLinksSchema,
} from "@/lib/validations/goals";

describe("createGoalSchema", () => {
  it("accepts a minimal manual_percent goal", () => {
    const r = createGoalSchema.safeParse({ name: "Grow ARR", progressMode: "manual_percent" });
    expect(r.success).toBe(true);
  });
  it("rejects an empty name", () => {
    const r = createGoalSchema.safeParse({ name: "", progressMode: "manual_percent" });
    expect(r.success).toBe(false);
  });
  it("rejects an unknown progress mode", () => {
    const r = createGoalSchema.safeParse({ name: "X", progressMode: "nope" });
    expect(r.success).toBe(false);
  });
});

describe("updateGoalSchema", () => {
  it("accepts a partial patch with a uuid id", () => {
    const r = updateGoalSchema.safeParse({
      goalId: "11111111-1111-4111-8111-111111111111",
      status: "at_risk",
    });
    expect(r.success).toBe(true);
  });
  it("rejects percent out of range", () => {
    const r = updateGoalSchema.safeParse({
      goalId: "11111111-1111-4111-8111-111111111111",
      percent: 140,
    });
    expect(r.success).toBe(false);
  });
});

describe("setGoalLinksSchema", () => {
  it("accepts a list of board links", () => {
    const r = setGoalLinksSchema.safeParse({
      goalId: "11111111-1111-4111-8111-111111111111",
      links: [
        {
          boardId: "22222222-2222-4222-8222-222222222222",
          doneColumnId: "33333333-3333-4333-8333-333333333333",
          doneOptionIds: ["44444444-4444-4444-8444-444444444444"],
        },
      ],
    });
    expect(r.success).toBe(true);
  });
});
