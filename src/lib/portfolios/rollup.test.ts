import { describe, expect, it } from "vitest";

import { computeAutoHealth, mergeRows, progressPct } from "./rollup";
import type { Placement, RollupRow, RowOwner } from "./types";

describe("progressPct", () => {
  it("is null when there is no done-column mapping", () => {
    expect(progressPct({ totalItems: 10, doneItems: 3, doneColumnId: null })).toBeNull();
  });
  it("is null when there are no items", () => {
    expect(progressPct({ totalItems: 0, doneItems: 0, doneColumnId: "c" })).toBeNull();
  });
  it("rounds done/total to a percentage", () => {
    expect(progressPct({ totalItems: 8, doneItems: 3, doneColumnId: "c" })).toBe(38);
  });
});

describe("computeAutoHealth", () => {
  const today = "2026-06-21";
  it("is null when there is nothing to judge", () => {
    expect(
      computeAutoHealth({ progressPct: null, timelineStart: null, timelineEnd: null, overdueItems: 0, today }),
    ).toBeNull();
  });
  it("is off_track when past the end date and unfinished", () => {
    expect(
      computeAutoHealth({ progressPct: 40, timelineStart: "2026-01-01", timelineEnd: "2026-06-01", overdueItems: 0, today }),
    ).toBe("off_track");
  });
  it("is at_risk when behind pace", () => {
    expect(
      computeAutoHealth({ progressPct: 20, timelineStart: "2026-06-01", timelineEnd: "2026-07-01", overdueItems: 0, today }),
    ).toBe("at_risk");
  });
  it("is at_risk when there are overdue items even if on pace", () => {
    expect(
      computeAutoHealth({ progressPct: 90, timelineStart: "2026-06-01", timelineEnd: "2026-07-01", overdueItems: 2, today }),
    ).toBe("at_risk");
  });
  it("is on_track when ahead of pace and nothing overdue", () => {
    expect(
      computeAutoHealth({ progressPct: 90, timelineStart: "2026-06-01", timelineEnd: "2026-07-01", overdueItems: 0, today }),
    ).toBe("on_track");
  });
});

describe("mergeRows", () => {
  it("joins placements + rollups + owners and applies the health override", () => {
    const placements: Placement[] = [
      {
        id: "p1", boardId: "b1", position: 1, ownerUserId: "u1", priority: "high",
        budget: 1000, healthOverride: "on_track", statusNote: "ok",
        doneColumnId: "c1", doneOptionIds: ["done"],
      },
    ];
    const rollups: RollupRow[] = [
      { boardId: "b1", name: "Launch", totalItems: 4, doneItems: 1, timelineStart: "2026-01-01", timelineEnd: "2026-02-01", overdueItems: 1 },
    ];
    const owners = new Map<string, RowOwner>([["u1", { userId: "u1", fullName: "Ada", avatarUrl: null }]]);

    const [row] = mergeRows(placements, rollups, owners, "2026-06-21");
    expect(row.name).toBe("Launch");
    expect(row.progressPct).toBe(25);
    expect(row.autoHealth).toBe("off_track");
    expect(row.health).toBe("on_track");
    expect(row.owner?.fullName).toBe("Ada");
  });
  it("falls back to autoHealth when no override is set", () => {
    const placements: Placement[] = [
      { id: "p2", boardId: "b2", position: 2, ownerUserId: null, priority: null, budget: null, healthOverride: null, statusNote: null, doneColumnId: null, doneOptionIds: [] },
    ];
    const rollups: RollupRow[] = [
      { boardId: "b2", name: "Backlog", totalItems: 0, doneItems: 0, timelineStart: null, timelineEnd: null, overdueItems: 0 },
    ];
    const [row] = mergeRows(placements, rollups, new Map(), "2026-06-21");
    expect(row.progressPct).toBeNull();
    expect(row.health).toBeNull();
    expect(row.owner).toBeNull();
  });
});
