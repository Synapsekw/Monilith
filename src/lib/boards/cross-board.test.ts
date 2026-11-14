import { describe, expect, it } from "vitest";
import { crossBoardStubs } from "@/lib/boards/cross-board";
import type { DependencyContext } from "@/lib/boards/timeline-context";

const span = (start: string, end: string) => ({
  start,
  end,
  isMilestone: start === end,
});
const FB = "11111111-1111-4111-8111-111111111111";
const FG = "22222222-2222-4222-8222-222222222222";
const ctx: DependencyContext = {
  boards: [
    {
      id: FB,
      name: "Procurement",
      can_edit: false,
      date_columns: [],
      timeline_config: null,
      groups: [],
    },
  ],
  items: [
    {
      id: "f1",
      board_id: FB,
      group_id: FG,
      parent_id: null,
      name: "PO raised",
      position: 0,
      created_at: "",
      updated_at: "",
      dates: {},
    },
  ],
};

describe("crossBoardStubs", () => {
  it("builds a late waiting-on stub for a foreign predecessor", () => {
    const m = crossBoardStubs({
      dependencies: [{ id: "d1", predecessor_id: "f1", successor_id: "l1" }],
      localItemIds: new Set(["l1"]),
      localSpans: new Map([["l1", span("2026-11-03", "2026-11-05")]]),
      context: ctx,
      contextSpans: new Map([["f1", span("2026-11-01", "2026-11-10")]]),
    });
    expect(m.get("l1")).toEqual([
      {
        dependencyId: "d1",
        direction: "waiting_on",
        itemId: "f1",
        itemName: "PO raised",
        boardId: FB,
        boardName: "Procurement",
        endISO: "2026-11-10",
        late: true,
      },
    ]);
  });
  it("builds a blocking stub for a foreign successor", () => {
    const m = crossBoardStubs({
      dependencies: [{ id: "d2", predecessor_id: "l1", successor_id: "f1" }],
      localItemIds: new Set(["l1"]),
      localSpans: new Map([["l1", span("2026-11-01", "2026-11-02")]]),
      context: ctx,
      contextSpans: new Map([["f1", span("2026-11-03", "2026-11-04")]]),
    });
    expect(m.get("l1")?.[0]).toMatchObject({
      direction: "blocking",
      late: false,
    });
  });
  it("ignores intra-board links and links to unknown foreign items", () => {
    const m = crossBoardStubs({
      dependencies: [
        { id: "d3", predecessor_id: "l1", successor_id: "l2" },
        { id: "d4", predecessor_id: "zz", successor_id: "l1" },
      ],
      localItemIds: new Set(["l1", "l2"]),
      localSpans: new Map(),
      context: ctx,
      contextSpans: new Map(),
    });
    expect(m.size).toBe(0);
  });
});
