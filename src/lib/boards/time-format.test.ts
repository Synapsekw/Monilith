import { describe, expect, it } from "vitest";
import {
  parseDuration,
  formatDuration,
  trackedSeconds,
  type TimeEntryLike,
} from "./time-format";

describe("parseDuration", () => {
  it("parses h/m forms", () => {
    expect(parseDuration("1h 30m")).toBe(5400);
    expect(parseDuration("90m")).toBe(5400);
    expect(parseDuration("1.5h")).toBe(5400);
    expect(parseDuration("2h")).toBe(7200);
  });
  it("bare number = minutes", () => {
    expect(parseDuration("45")).toBe(2700);
  });
  it("h:mm clock form", () => {
    expect(parseDuration("2:30")).toBe(9000);
  });
  it("rejects junk and non-positive", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("0m")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("drops zero parts", () => {
    expect(formatDuration(9900)).toBe("2h 45m");
    expect(formatDuration(14400)).toBe("4h");
    expect(formatDuration(900)).toBe("15m");
    expect(formatDuration(0)).toBe("0m");
  });
});

describe("trackedSeconds", () => {
  const now = Date.UTC(2026, 5, 20, 12, 0, 0);
  it("sums completed + live-ticks running", () => {
    const entries: TimeEntryLike[] = [
      { ended_at: "x", duration_secs: 600, started_at: "a" },
      {
        ended_at: null,
        duration_secs: null,
        started_at: new Date(now - 60_000).toISOString(),
      },
    ];
    expect(trackedSeconds(entries, now)).toBe(660);
  });
});
