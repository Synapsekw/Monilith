import { describe, expect, it } from "vitest";
import { ALL_ITEMS_KEY, buildStages, stageKey } from "./stages";
import type { RollupRow } from "./types";

const row = (
  o: Partial<RollupRow> & { boardId: string; groupName: string | null },
): RollupRow => ({
  boardName: o.boardId,
  boardPosition: 0,
  groupId: o.groupName ? `${o.boardId}:${o.groupName}` : null,
  groupColor: "#0073ea",
  groupPosition: 0,
  total: 0,
  done: 0,
  inProgress: 0,
  overdue: 0,
  notStarted: 0,
  blocked: 0,
  stale: 0,
  unassigned: 0,
  incomplete: 0,
  plannedByToday: 0,
  dueThisWeek: 0,
  dueThisWeekNotStarted: 0,
  oldestOverdue: null,
  minDue: null,
  maxDue: null,
  ...o,
});

describe("stageKey", () => {
  it("trims and lower-cases", () => {
    expect(stageKey("  Wave 2 ")).toBe("wave 2");
  });
});

describe("buildStages", () => {
  it("merges same-named groups across boards, first-seen casing and colour, ordered by min position", () => {
    const stages = buildStages(
      [
        row({
          boardId: "b1",
          boardPosition: 0,
          groupName: "Build",
          groupPosition: 2,
          groupColor: "#111111",
          total: 2,
          done: 1,
          inProgress: 1,
        }),
        row({
          boardId: "b2",
          boardPosition: 1,
          groupName: "build",
          groupPosition: 0,
          groupColor: "#222222",
          total: 3,
          done: 3,
        }),
        row({
          boardId: "b1",
          boardPosition: 0,
          groupName: "Discovery",
          groupPosition: 1,
          total: 1,
          done: 1,
        }),
      ],
      "2026-09-15",
    );
    expect(stages.map((s) => s.key)).toEqual(["build", "discovery"]);
    expect(stages[0]).toMatchObject({
      name: "Build",
      color: "#111111",
      total: 5,
      done: 4,
      boardIds: ["b1", "b2"],
      onlyOnBoard: null,
    });
    expect(stages[1]).toMatchObject({
      name: "Discovery",
      onlyOnBoard: "b1",
      total: 1,
      done: 1,
      state: "complete",
    });
  });

  it("derives state: complete / in_flight / upcoming", () => {
    const stages = buildStages(
      [
        row({
          boardId: "b1",
          groupName: "A",
          groupPosition: 0,
          total: 2,
          done: 2,
        }),
        row({
          boardId: "b1",
          groupName: "B",
          groupPosition: 1,
          total: 2,
          inProgress: 1,
          notStarted: 1,
        }),
        row({
          boardId: "b1",
          groupName: "C",
          groupPosition: 2,
          total: 2,
          notStarted: 2,
          minDue: "2026-09-01",
          maxDue: "2026-09-30",
        }),
        row({
          boardId: "b1",
          groupName: "D",
          groupPosition: 3,
          total: 2,
          notStarted: 2,
          minDue: "2026-10-01",
          maxDue: "2026-10-30",
        }),
        row({ boardId: "b1", groupName: "E", groupPosition: 4, total: 0 }),
      ],
      "2026-09-15",
    );
    expect(stages.map((s) => s.state)).toEqual([
      "complete",
      "in_flight",
      "in_flight",
      "upcoming",
      "upcoming",
    ]);
  });

  it("synthesises one 'All items' stage when no board has groups", () => {
    const stages = buildStages(
      [
        row({
          boardId: "b1",
          groupName: null,
          total: 4,
          done: 1,
          notStarted: 3,
        }),
      ],
      "2026-09-15",
    );
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({
      key: ALL_ITEMS_KEY,
      name: "All items",
      total: 4,
    });
  });

  it("ignores null-group rows when real groups exist", () => {
    const stages = buildStages(
      [
        row({ boardId: "b1", groupName: "A", total: 1 }),
        row({ boardId: "b2", groupName: null, total: 0 }),
      ],
      "2026-09-15",
    );
    expect(stages.map((s) => s.key)).toEqual(["a"]);
  });
});
