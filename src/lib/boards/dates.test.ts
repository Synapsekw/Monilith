import { describe, it, expect } from "vitest";
import {
  resolveDateColumn,
  itemDateRange,
  resolveTimelineSpan,
} from "@/lib/boards/dates";
import type { CacheCellValue } from "@/lib/boards/cache";

const cols = [
  { id: "c1", kind: "text" },
  { id: "d1", kind: "date" },
  { id: "d2", kind: "date" },
] as never;

describe("resolveDateColumn", () => {
  it("returns the configured date column when valid", () => {
    expect(resolveDateColumn(cols, { date_column_id: "d2" })?.id).toBe("d2");
  });
  it("falls back to the first date column", () => {
    expect(resolveDateColumn(cols, { date_column_id: "c1" })?.id).toBe("d1");
    expect(resolveDateColumn(cols, {})?.id).toBe("d1");
  });
  it("returns null when there is no date column", () => {
    expect(
      resolveDateColumn([{ id: "c1", kind: "text" }] as never, {}),
    ).toBeNull();
  });
});

describe("itemDateRange", () => {
  const cells = [
    {
      item_id: "i1",
      column_id: "d1",
      value: { date: "2026-06-10", end: "2026-06-12" },
    },
    { item_id: "i2", column_id: "d1", value: { date: "2026-06-15" } },
  ] as never;
  it("returns start+end for a range", () => {
    expect(itemDateRange("i1", cells, "d1")).toEqual({
      start: "2026-06-10",
      end: "2026-06-12",
    });
  });
  it("uses date as end when end is absent", () => {
    expect(itemDateRange("i2", cells, "d1")).toEqual({
      start: "2026-06-15",
      end: "2026-06-15",
    });
  });
  it("returns null when the item has no date cell", () => {
    expect(itemDateRange("i3", cells, "d1")).toBeNull();
  });
});

describe("resolveTimelineSpan", () => {
  const cells = [
    { item_id: "both", column_id: "start", value: { date: "2026-06-02" } },
    { item_id: "both", column_id: "end", value: { date: "2026-06-05" } },
    { item_id: "startonly", column_id: "start", value: { date: "2026-06-02" } },
    { item_id: "endonly", column_id: "end", value: { date: "2026-06-09" } },
    { item_id: "inverted", column_id: "start", value: { date: "2026-06-10" } },
    { item_id: "inverted", column_id: "end", value: { date: "2026-06-01" } },
    {
      item_id: "legacy",
      column_id: "start",
      value: { date: "2026-06-02", end: "2026-06-04" },
    },
  ] as unknown as CacheCellValue[];

  it("draws a span when both dates exist", () => {
    expect(resolveTimelineSpan("both", cells, "start", "end")).toEqual({
      start: "2026-06-02",
      end: "2026-06-05",
      isMilestone: false,
    });
  });

  it("draws a dot at the start when only start exists", () => {
    expect(resolveTimelineSpan("startonly", cells, "start", "end")).toEqual({
      start: "2026-06-02",
      end: "2026-06-02",
      isMilestone: true,
    });
  });

  it("draws a dot at the end when only end exists", () => {
    expect(resolveTimelineSpan("endonly", cells, "start", "end")).toEqual({
      start: "2026-06-09",
      end: "2026-06-09",
      isMilestone: true,
    });
  });

  it("returns null when neither date exists", () => {
    expect(resolveTimelineSpan("none", cells, "start", "end")).toBeNull();
  });

  it("clamps an inverted range to a dot at the start", () => {
    expect(resolveTimelineSpan("inverted", cells, "start", "end")).toEqual({
      start: "2026-06-10",
      end: "2026-06-10",
      isMilestone: true,
    });
  });

  it("uses the legacy single-column .end when endColumnId is null", () => {
    expect(resolveTimelineSpan("legacy", cells, "start", null)).toEqual({
      start: "2026-06-02",
      end: "2026-06-04",
      isMilestone: false,
    });
  });
});
