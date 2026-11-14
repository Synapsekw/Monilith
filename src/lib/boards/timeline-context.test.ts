import { describe, expect, it } from "vitest";
import {
  contextSpans,
  dependencyContextSchema,
  folderTimelineSchema,
  spanOfContextItem,
  type TimelineBoard,
  type TimelineItem,
} from "@/lib/boards/timeline-context";

const B = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";
const I = "33333333-3333-4333-8333-333333333333";
const START = "44444444-4444-4444-8444-444444444444";
const END = "55555555-5555-4555-8555-555555555555";

const board: TimelineBoard = {
  id: B,
  name: "Procurement",
  can_edit: true,
  date_columns: [
    { id: START, name: "Start" },
    { id: END, name: "Due" },
  ],
  timeline_config: null,
  groups: [{ id: G, name: "MVP", color: "#888", position: 0 }],
};
const item: TimelineItem = {
  id: I,
  board_id: B,
  group_id: G,
  parent_id: null,
  name: "PO raised",
  position: 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  dates: { [START]: { date: "2026-11-01" }, [END]: { date: "2026-11-09" } },
};

describe("timeline-context", () => {
  it("parses RPC JSON", () => {
    expect(
      dependencyContextSchema.parse({ boards: [board], items: [item] })
        .items[0]!.name,
    ).toBe("PO raised");
    expect(
      folderTimelineSchema.parse({
        board_order: [B],
        boards: [board],
        items: [item],
        external_item_ids: [],
        dependencies: [],
        total_items: 1,
        truncated: false,
      }).truncated,
    ).toBe(false);
  });
  it("resolves a span through the board's schedule", () => {
    expect(spanOfContextItem(item, board)).toEqual({
      start: "2026-11-01",
      end: "2026-11-09",
      isMilestone: false,
    });
  });
  it("returns null for a board with no date columns", () => {
    expect(spanOfContextItem(item, { ...board, date_columns: [] })).toBeNull();
  });
  it("maps every context item to its span", () => {
    expect(contextSpans({ boards: [board], items: [item] }).get(I)?.end).toBe(
      "2026-11-09",
    );
  });
});
