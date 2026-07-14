import { describe, expect, it } from "vitest";
import {
  proposedActionSchema,
  validatedActionSchema,
  aiConversationHistorySchema,
} from "./schema";

describe("proposedActionSchema", () => {
  it("accepts a create_item with fields", () => {
    const r = proposedActionSchema.safeParse({
      kind: "create_item",
      boardId: "b1",
      groupId: "g1",
      name: "Ship v2",
      fields: {
        ownerUserIds: ["u1"],
        dueDate: "2026-07-17",
        statusOptionId: "o1",
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-ISO dueDate", () => {
    const r = proposedActionSchema.safeParse({
      kind: "create_item",
      boardId: "b1",
      groupId: "g1",
      name: "X",
      fields: { dueDate: "Friday" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(
      proposedActionSchema.safeParse({ kind: "delete_item", boardId: "b1" })
        .success,
    ).toBe(false);
  });

  it("rejects a create_item with an empty name", () => {
    expect(
      proposedActionSchema.safeParse({
        kind: "create_item",
        boardId: "b1",
        groupId: "g1",
        name: "",
      }).success,
    ).toBe(false);
  });
});

describe("validatedActionSchema", () => {
  it("requires a summary and warnings array", () => {
    const r = validatedActionSchema.safeParse({
      kind: "create_group",
      boardId: "b1",
      name: "Backlog",
      summary: "Create group 'Backlog'",
      warnings: [],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a validated action missing its summary", () => {
    const r = validatedActionSchema.safeParse({
      kind: "create_group",
      boardId: "b1",
      name: "Backlog",
      warnings: [],
    });
    expect(r.success).toBe(false);
  });
});

describe("aiConversationHistorySchema", () => {
  it("accepts a well-formed transcript (string + block content)", () => {
    const r = aiConversationHistorySchema.safeParse([
      { role: "user", content: "create task Ship v2" },
      { role: "assistant", content: [{ type: "text", text: "Which board?" }] },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects a turn with an unknown role", () => {
    const r = aiConversationHistorySchema.safeParse([
      { role: "system", content: "nope" },
    ]);
    expect(r.success).toBe(false);
  });

  it("rejects content that is neither a string nor an array", () => {
    const r = aiConversationHistorySchema.safeParse([
      { role: "user", content: 42 },
    ]);
    expect(r.success).toBe(false);
  });
});
