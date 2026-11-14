import { describe, expect, it } from "vitest";
import {
  isLinkLate,
  resolveBoardSchedule,
  scheduleFromPicks,
} from "@/lib/boards/schedule";
import { CREATED_AT_SOURCE } from "@/lib/boards/dates";

const cols = [
  { id: "c-due", name: "Due date" },
  { id: "c-start", name: "Start" },
];

describe("resolveBoardSchedule", () => {
  it("seeds start/end by column name when the view has no config", () => {
    expect(resolveBoardSchedule(cols, null)).toEqual({
      startSourceId: "c-start",
      endSourceId: "c-due",
      readOnly: false,
    });
  });
  it("honours explicit config picks", () => {
    expect(
      resolveBoardSchedule(cols, {
        date_column_id: "c-due",
        end_column_id: null,
      }),
    ).toEqual({
      startSourceId: "c-due",
      endSourceId: "c-due",
      readOnly: false,
    });
  });
  it("returns no schedule for a board without date columns", () => {
    expect(resolveBoardSchedule([], null)).toEqual({
      startSourceId: null,
      endSourceId: null,
      readOnly: false,
    });
  });
  it("marks synthetic sources read-only", () => {
    expect(
      resolveBoardSchedule(cols, { date_column_id: CREATED_AT_SOURCE }),
    ).toMatchObject({
      startSourceId: CREATED_AT_SOURCE,
      readOnly: true,
    });
  });
});

describe("scheduleFromPicks", () => {
  it("falls back to the first date column for an unknown start pick", () => {
    expect(scheduleFromPicks(cols, "gone", null).startSourceId).toBe("c-due");
  });
  it("keeps an explicit null end", () => {
    expect(scheduleFromPicks(cols, "c-start", null).endSourceId).toBeNull();
  });
});

describe("isLinkLate", () => {
  const span = (start: string, end: string) => ({
    start,
    end,
    isMilestone: start === end,
  });
  it("is late when the successor starts before the predecessor ends", () => {
    expect(
      isLinkLate(
        span("2026-11-01", "2026-11-10"),
        span("2026-11-05", "2026-11-20"),
      ),
    ).toBe(true);
  });
  it("is not late when the successor starts on or after the predecessor end", () => {
    expect(
      isLinkLate(
        span("2026-11-01", "2026-11-10"),
        span("2026-11-10", "2026-11-20"),
      ),
    ).toBe(false);
  });
  it("is never late when either end has no dates", () => {
    expect(isLinkLate(null, span("2026-11-01", "2026-11-02"))).toBe(false);
  });
});
