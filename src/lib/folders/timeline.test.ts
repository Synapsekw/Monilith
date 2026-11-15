import { describe, expect, it } from "vitest";
import { buildFolderTimeline } from "@/lib/folders/timeline";
import { ALL_ITEMS_KEY } from "@/lib/folders/stages";
import type { FolderTimelineData } from "@/lib/boards/timeline-context";
import type { RollupRow } from "@/lib/folders/types";

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

// The folder opens with everything closed.
const closed = {
  stageKey: null,
  boardId: null,
  expanded: new Set<string>(),
  zoom: "month" as const,
  expandedBoards: new Set<string>(),
  expandedGroups: new Set<string>(),
  todayISO: "2026-11-14",
};
// Every board and group opened, for the tests about item rows.
const opts = {
  ...closed,
  expandedBoards: new Set([A, B]),
  expandedGroups: new Set([GA, GB]),
};
const names = (v: { rows: { name: string }[] }) => v.rows.map((r) => r.name);
const roll = (
  boardId: string,
  groupId: string,
  total: number,
  done: number,
  overdue: number,
) => ({ boardId, groupId, total, done, overdue }) as RollupRow;

describe("buildFolderTimeline — roll-up first", () => {
  it("opens as one band per board", () => {
    expect(names(buildFolderTimeline(data, closed))).toEqual([
      "Platform",
      "Sites",
    ]);
  });
  it("an expanded board shows its group bands, not its items", () => {
    expect(
      names(
        buildFolderTimeline(data, { ...closed, expandedBoards: new Set([A]) }),
      ),
    ).toEqual(["Platform", "MVP", "Sites"]);
  });
  it("an expanded group shows its items", () => {
    expect(
      names(
        buildFolderTimeline(data, {
          ...closed,
          expandedBoards: new Set([A]),
          expandedGroups: new Set([GA]),
        }),
      ),
    ).toEqual(["Platform", "MVP", "QCC build", "Sites"]);
  });
  it("gives closed bands the span of what is under them", () => {
    // Range starts at today − 14 = 2026-10-31, so 11-10 is day 10, 11-05 day 5.
    const v = buildFolderTimeline(data, closed);
    expect(v.rangeStartISO).toBe("2026-10-31");
    expect(v.rows.map((r) => r.summary)).toEqual([
      { startCol: 10, spanCols: 1, donePct: null, lateCount: null },
      { startCol: 5, spanCols: 1, donePct: null, lateCount: null },
    ]);
  });
  it("joins rollup rows by board id and group id", () => {
    const v = buildFolderTimeline(data, {
      ...opts,
      rollup: [roll(A, GA, 20, 7, 8)],
    });
    const band = (id: string) => v.rows.find((r) => r.itemId === id)?.summary;
    expect(band(`board:${A}`)).toMatchObject({ donePct: 35, lateCount: 8 });
    expect(band(`group:${GA}`)).toMatchObject({ donePct: 35, lateCount: 8 });
    // No rollup row for this board or group: span only, no fill.
    expect(band(`board:${B}`)).toMatchObject({
      donePct: null,
      lateCount: null,
    });
    expect(band(`group:${GB}`)).toMatchObject({
      donePct: null,
      lateCount: null,
    });
  });
  it("sums a board band over every rollup row passed for that board", () => {
    const v = buildFolderTimeline(data, {
      ...closed,
      rollup: [roll(A, GA, 10, 2, 1), roll(A, "other-group", 10, 8, 2)],
    });
    expect(v.rows[0]!.summary).toMatchObject({ donePct: 50, lateCount: 3 });
  });
  it("gives an empty rollup group no percentage", () => {
    const v = buildFolderTimeline(data, {
      ...closed,
      rollup: [roll(A, GA, 0, 0, 0)],
    });
    expect(v.rows[0]!.summary).toMatchObject({ donePct: null, lateCount: 0 });
  });
  it("counts late links while every board is closed", () => {
    const v = buildFolderTimeline(data, closed);
    expect(v.dependencies).toEqual([]);
    expect(v.violations.size).toBe(0);
    // d1: b1 starts 11-05, before a1 ends 11-10.
    expect(v.totals.lateLinks).toBe(1);
  });
  it("widens the range to include today even when all dates are old", () => {
    const old = {
      ...data,
      items: data.items.map((i) =>
        i.id === "a1" ? { ...i, dates: { [DA]: { date: "2026-02-03" } } } : i,
      ),
    };
    const v = buildFolderTimeline(old, closed);
    expect(v.rangeStartISO).toBe("2026-02-03");
    // 2026-02-03 → 2026-12-14 (today + 30) inclusive, + 3 days of padding.
    expect(v.dayCount).toBe(318);
  });
});

describe("buildFolderTimeline — opened", () => {
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
    expect(v.totals.lateLinks).toBe(1);
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
      names(buildFolderTimeline(data, { ...opts, stageKey: "pilot" })),
    ).toEqual(["Sites", "Pilot", "Site survey"]);
    expect(names(buildFolderTimeline(data, { ...opts, boardId: A }))).toEqual([
      "Platform",
      "MVP",
      "QCC build",
    ]);
  });
  it("treats the all-items stage as no stage filter", () => {
    expect(
      buildFolderTimeline(data, { ...opts, stageKey: ALL_ITEMS_KEY }).rows,
    ).toEqual(buildFolderTimeline(data, opts).rows);
  });
  it("counts boards and items independently of what is open", () => {
    expect(buildFolderTimeline(data, opts).totals).toMatchObject({
      boards: 2,
      items: 2,
    });
    expect(buildFolderTimeline(data, closed).totals).toMatchObject({
      boards: 2,
      items: 2,
    });
    expect(
      buildFolderTimeline(data, { ...opts, boardId: A }).totals,
    ).toMatchObject({ boards: 1, items: 1 });
  });
  it("still notes a closed board with no dates, and gives it no summary", () => {
    const undated = {
      ...data,
      items: data.items.map((i) =>
        i.board_id === B ? { ...i, dates: {} } : i,
      ),
    };
    const v = buildFolderTimeline(undated, closed);
    expect(v.noDateBoards.has(B)).toBe(true);
    expect(
      v.rows.find((r) => r.itemId === `board:${B}`)?.summary,
    ).toBeUndefined();
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
    expect(names(v)).toEqual(["Platform", "MVP", "QCC build", "Sites"]);
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
    expect(v.totals.lateLinks).toBe(1);
  });
});
