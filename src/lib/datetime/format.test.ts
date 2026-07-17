import { describe, it, expect } from "vitest";
import { formatDateTime } from "./format";

const ISO = "2026-06-21T15:45:00Z";

describe("formatDateTime", () => {
  it("formats an absolute date and time in the given zone", () => {
    const out = formatDateTime(ISO, { timeZone: "UTC" });
    expect(out).toContain("2026");
    expect(out).toMatch(/3:45|15:45/); // locale may be 12h or 24h
  });

  it("produces different output for different zones", () => {
    const utc = formatDateTime(ISO, { timeZone: "UTC" });
    const tokyo = formatDateTime(ISO, { timeZone: "Asia/Tokyo" });
    expect(utc).not.toEqual(tokyo);
  });

  it("accepts a Date instance", () => {
    expect(formatDateTime(new Date(ISO), { timeZone: "UTC" })).toContain(
      "2026",
    );
  });

  it("formats with a pinned locale (deterministic order, not runtime-default)", () => {
    // en-US medium date renders "Mon DD, YYYY" — assert the month-first shape so a
    // runtime whose default locale is day-first can't drift the string.
    const out = formatDateTime("2026-06-21T15:45:00Z", { timeZone: "UTC" });
    expect(out).toMatch(/^Jun 21, 2026/);
  });
});
