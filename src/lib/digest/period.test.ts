import { describe, expect, it } from "vitest";
import {
  DIGEST_WINDOW_DAYS,
  currentDigestPeriod,
  digestWindowStart,
} from "@/lib/digest/period";

describe("currentDigestPeriod", () => {
  it("returns the Monday..Sunday UTC week containing now", () => {
    // Wednesday 2026-07-01 12:00 UTC → week Mon 2026-06-29 .. Sun 2026-07-05
    const p = currentDigestPeriod(new Date("2026-07-01T12:00:00Z"));
    expect(p).toEqual({ periodStart: "2026-06-29", periodEnd: "2026-07-05" });
  });

  it("a Monday maps to itself", () => {
    const p = currentDigestPeriod(new Date("2026-06-29T07:00:00Z"));
    expect(p.periodStart).toBe("2026-06-29");
  });

  it("a Sunday maps back to the preceding Monday", () => {
    const p = currentDigestPeriod(new Date("2026-07-05T23:59:59Z"));
    expect(p).toEqual({ periodStart: "2026-06-29", periodEnd: "2026-07-05" });
  });
});

describe("digestWindowStart", () => {
  it("is exactly one week before now", () => {
    const now = new Date("2026-07-27T07:00:00Z");
    expect(digestWindowStart(now).toISOString()).toBe(
      "2026-07-20T07:00:00.000Z",
    );
    expect(DIGEST_WINDOW_DAYS).toBe(7);
  });

  it("starts no earlier than the period it labels", () => {
    // The window must not reach back past the Monday of the week the run is
    // filed under by more than one period — otherwise a digest labelled
    // "Week of X" reports activity nobody would call that week's.
    const now = new Date("2026-07-27T07:00:00Z"); // a Monday
    const { periodStart } = currentDigestPeriod(now);
    const priorMonday = new Date(`${periodStart}T00:00:00Z`);
    priorMonday.setUTCDate(priorMonday.getUTCDate() - 7);
    expect(digestWindowStart(now).getTime()).toBeGreaterThanOrEqual(
      priorMonday.getTime(),
    );
  });

  it("never reaches back before the current period, however old the feature is", () => {
    const featureShipped = new Date("2026-07-03T00:00:00Z");
    const now = new Date("2026-07-27T07:00:00Z");
    expect(digestWindowStart(now).getTime()).toBeGreaterThan(
      featureShipped.getTime(),
    );
  });
});
