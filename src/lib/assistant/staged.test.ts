import { describe, it, expect } from "vitest";
import {
  MAX_STAGED_CALLS,
  stagedCallSchema,
  stagedResultSchema,
} from "./staged";

const call = {
  id: "call-1",
  tool: "update_item",
  input: { itemId: "i-1" },
  summary: "Update an item.",
  destructive: false,
  boardId: null,
};

describe("staged call contract", () => {
  it("caps a turn at 50 staged calls", () => {
    expect(MAX_STAGED_CALLS).toBe(50);
  });
  it("accepts a well-formed call", () => {
    expect(stagedCallSchema.safeParse(call).success).toBe(true);
  });
  it("rejects a call with no tool name", () => {
    expect(stagedCallSchema.safeParse({ ...call, tool: "" }).success).toBe(
      false,
    );
  });
  it("accepts a skipped result without an error", () => {
    expect(
      stagedResultSchema.safeParse({ id: "call-1", ok: false, skipped: true })
        .success,
    ).toBe(true);
  });
});
