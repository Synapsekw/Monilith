import { describe, it, expect } from "vitest";
import {
  resolveDateColumn,
  itemDateRange,
  resolveTimelineSpan,
  defaultTimelineColumns,
  isSyntheticDateSource,
  syntheticDateCellValues,
  CREATED_AT_SOURCE,
  UPDATED_AT_SOURCE,
} from "@/lib/boards/dates";
import type { CacheCellValue, CacheItem } from "@/lib/boards/cache";

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

describe("isSyntheticDateSource", () => {
  it("recognises the created/updated sentinels", () => {
    expect(isSyntheticDateSource(CREATED_AT_SOURCE)).toBe(true);
    expect(isSyntheticDateSource(UPDATED_AT_SOURCE)).toBe(true);
  });
  it("rejects real column ids and nullish input", () => {
    expect(isSyntheticDateSource("d1")).toBe(false);
    expect(isSyntheticDateSource(null)).toBe(false);
    expect(isSyntheticDateSource(undefined)).toBe(false);
  });
});

describe("syntheticDateCellValues", () => {
  const items = [
    {
      id: "i1",
      board_id: "b1",
      org_id: "o1",
      created_at: "2026-06-10T14:32:00.123Z",
      updated_at: "2026-07-01T09:00:00.000Z",
    },
    {
      id: "i2",
      board_id: "b1",
      org_id: "o1",
      created_at: "2026-06-15T00:00:00.000Z",
      updated_at: "2026-07-02T00:00:00.000Z",
    },
  ] as unknown as CacheItem[];

  it("emits a date-only cell per item for the created-at source", () => {
    const cells = syntheticDateCellValues(items, [CREATED_AT_SOURCE]);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({
      item_id: "i1",
      column_id: CREATED_AT_SOURCE,
      value: { date: "2026-06-10" },
    });
  });

  it("slices the timestamp to YYYY-MM-DD so day math still works", () => {
    const [cell] = syntheticDateCellValues(items, [UPDATED_AT_SOURCE]);
    expect((cell.value as { date: string }).date).toBe("2026-07-01");
  });

  it("emits one cell per item per requested source", () => {
    const cells = syntheticDateCellValues(items, [
      CREATED_AT_SOURCE,
      UPDATED_AT_SOURCE,
    ]);
    expect(cells).toHaveLength(4);
  });
});

describe("defaultTimelineColumns", () => {
  it("matches start and end columns by name", () => {
    const cols = [
      { id: "a", name: "Start Date" },
      { id: "b", name: "Due Date" },
      { id: "c", name: "Other" },
    ];
    expect(defaultTimelineColumns(cols)).toEqual({
      startColumnId: "a",
      endColumnId: "b",
    });
  });
  it("falls back to the first date column for start and null for end", () => {
    const cols = [{ id: "x", name: "When" }];
    expect(defaultTimelineColumns(cols)).toEqual({
      startColumnId: "x",
      endColumnId: null,
    });
  });
  it("never reuses the start column as the end column", () => {
    const cols = [{ id: "a", name: "Start / End" }];
    expect(defaultTimelineColumns(cols)).toEqual({
      startColumnId: "a",
      endColumnId: null,
    });
  });
  it("returns nulls for no date columns", () => {
    expect(defaultTimelineColumns([])).toEqual({
      startColumnId: null,
      endColumnId: null,
    });
  });
});
