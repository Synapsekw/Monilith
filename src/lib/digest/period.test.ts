import { describe, expect, it } from "vitest";
import { currentDigestPeriod } from "@/lib/digest/period";

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
