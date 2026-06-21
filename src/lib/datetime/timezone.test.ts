import { describe, it, expect } from "vitest";
import { listTimeZones, timezoneLabel } from "./timezone";

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
