import { describe, expect, it } from "vitest";
import { todayInTimeZone } from "./today";

// 2026-11-14T22:30:00Z
const NOW = Date.UTC(2026, 10, 14, 22, 30);

describe("todayInTimeZone", () => {
  it("returns the UTC date and flags the assumption when no zone is set", () => {
    expect(todayInTimeZone(null, NOW)).toEqual({
      today: "2026-11-14",
      timezoneAssumed: true,
    });
  });
  it("rolls to the next day east of UTC", () => {
    expect(todayInTimeZone("Asia/Tokyo", NOW)).toEqual({
      today: "2026-11-15",
      timezoneAssumed: false,
    });
  });
  it("stays on the same day west of UTC", () => {
    expect(todayInTimeZone("America/Los_Angeles", NOW).today).toBe(
      "2026-11-14",
    );
  });
  it("falls back to UTC for a zone the runtime rejects", () => {
    expect(todayInTimeZone("Not/AZone", NOW)).toEqual({
      today: "2026-11-14",
      timezoneAssumed: true,
    });
  });
});
