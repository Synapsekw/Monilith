import { describe, expect, it } from "vitest";
import { cellKey, type CacheCellValue } from "@/lib/boards/cache";
import { groupProgress } from "./group-progress";

const column = {
  id: "c_status",
  settings: {
    options: [
      { id: "o_done", label: "Done", color: "#00c875" },
      { id: "o_complete", label: "Completed", color: "#00c875" },
      { id: "o_wip", label: "Working on it", color: "#fdab3d" },
    ],
  },
} as never;
/** The guess: no configured done options. */
const rule = { statusColumn: column, doneOptionIds: null };

function cells(
  entries: [itemId: string, optionId: string][],
): Map<string, CacheCellValue["value"]> {
  return new Map(
    entries.map(([itemId, optionId]) => [
      cellKey(itemId, "c_status"),
      { optionId } as CacheCellValue["value"],
    ]),
  );
}

describe("groupProgress", () => {
  it("counts items whose status is done by the board's done rule", () => {
    const map = cells([
      ["i1", "o_done"],
      ["i2", "o_wip"],
      ["i3", "o_complete"],
    ]);
    expect(groupProgress(["i1", "i2", "i3", "i4"], rule, map)).toEqual({
      done: 2,
      total: 4,
      percent: 50,
    });
  });

  it("rounds the percentage", () => {
    const map = cells([["i1", "o_done"]]);
    expect(groupProgress(["i1", "i2", "i3"], rule, map)?.percent).toBe(33);
  });

  it("is 0% when nothing is done", () => {
    expect(groupProgress(["i1"], rule, new Map())).toEqual({
      done: 0,
      total: 1,
      percent: 0,
    });
  });

  it("is null without a status column (no meter)", () => {
    expect(groupProgress(["i1"], null, new Map())).toBeNull();
    expect(
      groupProgress(
        ["i1"],
        { statusColumn: null, doneOptionIds: null },
        new Map(),
      ),
    ).toBeNull();
  });

  it("counts the CONFIGURED done options, not the labels", () => {
    const map = cells([
      ["i1", "o_done"],
      ["i2", "o_wip"],
      ["i3", "o_complete"],
    ]);
    expect(
      groupProgress(
        ["i1", "i2", "i3"],
        { statusColumn: column, doneOptionIds: ["o_wip"] },
        map,
      ),
    ).toEqual({ done: 1, total: 3, percent: 33 });
  });

  it("is null for an empty group (no meter)", () => {
    expect(groupProgress([], rule, new Map())).toBeNull();
  });

  it("ignores cells of items outside the group", () => {
    const map = cells([
      ["i1", "o_wip"],
      ["other", "o_done"],
    ]);
    expect(groupProgress(["i1"], rule, map)?.done).toBe(0);
  });
});
