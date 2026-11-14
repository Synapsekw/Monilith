import { describe, expect, it } from "vitest";
import { buildFolderTimeline } from "@/lib/folders/timeline";
import type { FolderTimelineData } from "@/lib/boards/timeline-context";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const X = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DA = "f0000000-0000-4000-8000-00000000000a";
const DB = "f0000000-0000-4000-8000-00000000000b";

const item = (
  id: string,
  board: string,
  group: string,
  name: string,
  col: string,
  date: string,
) => ({
  id,
  board_id: board,
  group_id: group,
  parent_id: null,
  name,
  position: 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  dates: { [col]: { date } },
});

const data: FolderTimelineData = {
  board_order: [A, B],
  boards: [
    {
      id: A,
      name: "Platform",
      can_edit: true,
      date_columns: [{ id: DA, name: "Due" }],
      timeline_config: null,
      groups: [{ id: GA, name: "MVP", color: "#888", position: 0 }],
    },
    {
      id: B,
      name: "Sites",
      can_edit: false,
      date_columns: [{ id: DB, name: "Due" }],
      timeline_config: null,
      groups: [{ id: GB, name: "Pilot", color: "#888", position: 0 }],
    },
    {
      id: X,
      name: "Regulatory",
      can_edit: false,
      date_columns: [],
      timeline_config: null,
      groups: [],
    },
  ],
  items: [
    item("a1", A, GA, "QCC build", DA, "2026-11-10"),
    item("b1", B, GB, "Site survey", DB, "2026-11-05"),
    { ...item("x1", X, GA, "Permit", DA, "2026-11-01"), dates: {} },
  ],
  external_item_ids: ["x1"],
  dependencies: [
    { id: "d1", predecessor_id: "a1", successor_id: "b1" },
    { id: "d2", predecessor_id: "x1", successor_id: "a1" },
  ],
  total_items: 2,
  truncated: false,
};

const opts = {
  stageKey: null,
  boardId: null,
  expanded: new Set<string>(),
  zoom: "month" as const,
  collapsedBoards: new Set<string>(),
};

describe("buildFolderTimeline", () => {
  it("emits board bands, group bands and items in folder order", () => {
    const v = buildFolderTimeline(data, opts);
    expect(v.rows.map((r) => `${r.kind ?? "item"}:${r.name}`)).toEqual([
      "section:Platform",
      "section:MVP",
      "item:QCC build",
      "section:Sites",
      "section:Pilot",
      "item:Site survey",
    ]);
  });
  it("draws in-folder links as arrows and flags the late one", () => {
    const v = buildFolderTimeline(data, opts);
    expect(v.dependencies.map((d) => d.id)).toEqual(["d1"]);
    expect(v.violations.has("d1")).toBe(true); // b1 starts 11-05, before a1 ends 11-10
  });
  it("turns links to external items into stubs", () => {
    const v = buildFolderTimeline(data, opts);
    expect(v.externalLinks.get("a1")?.[0]).toMatchObject({
      itemName: "Permit",
      boardName: "Regulatory",
      direction: "waiting_on",
    });
  });
  it("filters by stage (group name) and board", () => {
    expect(
      buildFolderTimeline(data, { ...opts, stageKey: "pilot" }).rows.map(
        (r) => r.name,
      ),
    ).toEqual(["Sites", "Pilot", "Site survey"]);
    expect(
      buildFolderTimeline(data, { ...opts, boardId: A }).rows.map(
        (r) => r.name,
      ),
    ).toEqual(["Platform", "MVP", "QCC build"]);
  });
  it("collapses a board band to its header", () => {
    expect(
      buildFolderTimeline(data, {
        ...opts,
        collapsedBoards: new Set([A]),
      }).rows.map((r) => r.name),
    ).toEqual(["Platform", "Sites", "Pilot", "Site survey"]);
  });
  it("keeps undated leaves off the chart and notes boards with no dates", () => {
    const v = buildFolderTimeline(
      {
        ...data,
        boards: data.boards.map((b) =>
          b.id === B ? { ...b, date_columns: [] } : b,
        ),
        items: [
          ...data.items,
          { ...item("a2", A, GA, "Undated", DA, "2026-11-01"), dates: {} },
        ],
      },
      opts,
    );
    expect(v.rows.map((r) => r.name)).toEqual([
      "Platform",
      "MVP",
      "QCC build",
      "Sites",
    ]);
    expect([...v.noDateBoards]).toEqual([B]);
    expect(v.boardOfItem.get("a1")).toBe(A);
    expect(v.boardOfItem.has("a2")).toBe(false);
  });
  it("turns a link to a filtered-out board into a stub", () => {
    const v = buildFolderTimeline(data, { ...opts, boardId: B });
    expect(v.dependencies).toEqual([]);
    expect(v.externalLinks.get("b1")?.[0]).toMatchObject({
      itemName: "QCC build",
      boardName: "Platform",
      direction: "waiting_on",
      late: true,
    });
  });
});
