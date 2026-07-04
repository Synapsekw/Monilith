import { describe, it, expect } from "vitest";
import {
  listTimeZones,
  timezoneLabel,
  zonedDayOf,
  zonedWallTimeToUtc,
} from "./timezone";

// Fixed reference dates make offset labels deterministic (no Date.now()).
const WINTER = new Date("2026-01-15T12:00:00Z");
const SUMMER = new Date("2026-07-15T12:00:00Z");

describe("listTimeZones", () => {
  it("returns a non-empty list including common zones", () => {
    const zones = listTimeZones();
    expect(zones).toContain("UTC");
    expect(zones).toContain("Europe/Belgrade");
    expect(zones.length).toBeGreaterThan(100);
  });
});

describe("timezoneLabel", () => {
  it("includes the city and a GMT offset", () => {
    const label = timezoneLabel("Europe/Belgrade", WINTER);
    expect(label).toContain("Belgrade");
    expect(label).toContain("GMT+1"); // CET in January
  });

  it("reflects DST in the offset for the reference date", () => {
    const label = timezoneLabel("Europe/Belgrade", SUMMER);
    expect(label).toContain("GMT+2"); // CEST in July
  });

  it("humanizes underscores in multi-word cities", () => {
    const label = timezoneLabel("America/New_York", WINTER);
    expect(label).toContain("New York");
  });
});

describe("zonedDayOf", () => {
  // A timer running "Monday 5pm" in Los Angeles is 2026-06-16T00:00:00Z (UTC).
  // Naive `.slice(0,10)` buckets it under Tuesday; the local day is Monday.
  it("buckets a late-evening UTC-8 instant into the local (previous) day", () => {
    const instant = "2026-06-16T00:00:00Z"; // Mon 5pm in LA (PDT, UTC-7 in June)
    expect(zonedDayOf(instant, "America/Los_Angeles")).toBe("2026-06-15");
    expect(zonedDayOf(instant, "UTC")).toBe("2026-06-16");
  });

  // Kiritimati is UTC+14: an instant late on the UTC calendar day is already the
  // next local day.
  it("buckets an evening-UTC instant into the local (next) day for UTC+14", () => {
    const instant = "2026-06-15T22:00:00Z"; // Tue noon in Kiritimati
    expect(zonedDayOf(instant, "Pacific/Kiritimati")).toBe("2026-06-16");
    expect(zonedDayOf(instant, "UTC")).toBe("2026-06-15");
  });

  it("is stable at UTC for a mid-day instant", () => {
    expect(zonedDayOf("2026-06-15T12:00:00Z", "UTC")).toBe("2026-06-15");
  });
});

describe("zonedWallTimeToUtc", () => {
  it("maps local midday to the correct UTC instant per zone", () => {
    // LA midday in June (PDT, UTC-7) → 19:00Z
    expect(
      zonedWallTimeToUtc("2026-06-15", 12, "America/Los_Angeles").toISOString(),
    ).toBe("2026-06-15T19:00:00.000Z");
    // Kiritimati midday (UTC+14) → previous UTC day 22:00Z
    expect(
      zonedWallTimeToUtc("2026-06-15", 12, "Pacific/Kiritimati").toISOString(),
    ).toBe("2026-06-14T22:00:00.000Z");
    // UTC midday is itself
    expect(zonedWallTimeToUtc("2026-06-15", 12, "UTC").toISOString()).toBe(
      "2026-06-15T12:00:00.000Z",
    );
  });

  it("supports hour=24 as the exclusive next-midnight window bound", () => {
    // LA local midnight after 2026-06-15 (start of the 16th) → 07:00Z on the 16th
    expect(
      zonedWallTimeToUtc("2026-06-15", 24, "America/Los_Angeles").toISOString(),
    ).toBe("2026-06-16T07:00:00.000Z");
  });

  // The write path (#2) stores midday; the read path (#1) buckets by local day.
  // They MUST agree: a day written round-trips to the same local day.
  it("round-trips: zonedDayOf(midday write) === the written day", () => {
    for (const tz of ["America/Los_Angeles", "Pacific/Kiritimati", "UTC"]) {
      for (const day of ["2026-01-15", "2026-06-15", "2026-12-31"]) {
        const stored = zonedWallTimeToUtc(day, 12, tz);
        expect(zonedDayOf(stored, tz)).toBe(day);
      }
    }
  });
});
