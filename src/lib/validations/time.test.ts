import { describe, expect, it } from "vitest";

import { upsertTimeAllocationSchema, deleteTimeAllocationSchema } from "./time";

// "11111111-1111-1111-1111-111111111111" fails Zod 4's strict UUID check
// (variant nibble must be [89ab]). Use UUIDs that satisfy version nibble=4
// and variant nibble=8 — matching the repo convention in other test files.
const ITEM = "11111111-1111-4111-8111-111111111111";
const BOARD = "22222222-2222-4222-8222-222222222222";

describe("upsertTimeAllocationSchema", () => {
  it("accepts a valid item allocation", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      itemId: ITEM,
      boardId: BOARD,
      hours: 2.5,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.durationSecs).toBe(9000);
  });

  it("accepts a valid category allocation (no board)", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Meetings",
      hours: 1,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.durationSecs).toBe(3600);
  });

  it("rejects both item and category set", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      itemId: ITEM,
      category: "Meetings",
      hours: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects neither item nor category set", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      hours: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects hours > 24", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Admin",
      hours: 24.5,
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative hours", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Admin",
      hours: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects 0 hours (use delete instead)", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Admin",
      hours: 0,
    });
    expect(r.success).toBe(false);
  });

  it("accepts the boundary 24 hours", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Admin",
      hours: 24,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a malformed date", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "06/23/2026",
      category: "Admin",
      hours: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a note longer than 500 chars", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Admin",
      hours: 1,
      note: "x".repeat(501),
    });
    expect(r.success).toBe(false);
  });
});

describe("deleteTimeAllocationSchema", () => {
  it("accepts an item+date key", () => {
    const r = deleteTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      itemId: ITEM,
    });
    expect(r.success).toBe(true);
  });
  it("accepts a category+date key", () => {
    const r = deleteTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Meetings",
    });
    expect(r.success).toBe(true);
  });
  it("rejects neither key", () => {
    const r = deleteTimeAllocationSchema.safeParse({ workDate: "2026-06-23" });
    expect(r.success).toBe(false);
  });
});
