import { describe, expect, it } from "vitest";
import { buildBoardTranscript } from "./transcript";
import type { Tables } from "@/types/database.types";

const update = (
  over: Partial<Tables<"item_updates">>,
): Tables<"item_updates"> => ({
  id: "u1",
  org_id: "o",
  board_id: "b",
  item_id: "i1",
  author_id: "ana",
  body: { text: "hi" },
  body_text: "hi",
  edited_at: null,
  created_at: "2026-09-10T09:00:00.000Z",
  updated_at: "2026-09-10T09:00:00.000Z",
  ...over,
});
const activity = (
  over: Partial<Tables<"item_activities">>,
): Tables<"item_activities"> => ({
  id: "a1",
  org_id: "o",
  board_id: "b",
  item_id: "i2",
  actor_id: "ana",
  action: "item_created",
  column_id: null,
  old_value: null,
  new_value: null,
  created_at: "2026-09-09T09:00:00.000Z",
  source: "user",
  ...over,
});
const members = [{ userId: "ana", fullName: "Ana" }];
const itemNames = new Map([
  ["i1", "Ship"],
  ["i2", "Test"],
]);

describe("buildBoardTranscript", () => {
  it("returns the empty sentinel with nothing to say", () => {
    expect(
      buildBoardTranscript({
        updates: [],
        activities: [],
        columns: [],
        members,
        itemNames,
        tokenBudget: 100,
      }),
    ).toBe("");
  });
  it("prefixes every line with the item name and sorts oldest first", () => {
    const out = buildBoardTranscript({
      updates: [update({})],
      activities: [activity({})],
      columns: [],
      members,
      itemNames,
      tokenBudget: 1000,
    });
    expect(out.split("\n")).toEqual([
      "[2026-09-09T09:00:00.000Z] (Test) Ana created this item",
      "[2026-09-10T09:00:00.000Z] (Ship) Ana: hi",
    ]);
  });
  it("drops the OLDEST lines first when over the token budget", () => {
    const updates = Array.from({ length: 20 }, (_, i) =>
      update({
        id: `u${i}`,
        body_text: "x".repeat(100),
        created_at: `2026-09-0${(i % 9) + 1}T0${i % 10}:00:00.000Z`,
      }),
    );
    const out = buildBoardTranscript({
      updates,
      activities: [],
      columns: [],
      members,
      itemNames,
      tokenBudget: 200,
    });
    const lines = out.split("\n");
    expect(lines.length).toBeLessThan(20);
    expect(lines.at(-1)).toContain("2026-09-09T0"); // the newest survived
  });
  it("sanitizes update bodies (no newlines, no angle brackets)", () => {
    const out = buildBoardTranscript({
      updates: [update({ body_text: "a\n<b>c</b>" })],
      activities: [],
      columns: [],
      members,
      itemNames,
      tokenBudget: 1000,
    });
    expect(out).toContain("(Ship) Ana: a bc/b");
  });
});
