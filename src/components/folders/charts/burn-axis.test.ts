import { describe, expect, it } from "vitest";
import { burnAxisTick, burnAxisWidth } from "./burn-axis";

describe("burn chart Y axis", () => {
  it("writes ticks in full up to four digits and compactly above", () => {
    expect(burnAxisTick(0)).toBe("0");
    expect(burnAxisTick(2200)).toBe("2200");
    expect(burnAxisTick(9999)).toBe("9999");
    expect(burnAxisTick(12_000)).toBe("12K");
    expect(burnAxisTick(1_250_000)).toBe("1.3M");
  });

  it("is wide enough for the longest tick the domain can produce", () => {
    // Small values keep the old 28px width.
    expect(burnAxisWidth(0)).toBe(28);
    expect(burnAxisWidth(40)).toBe(28);
    // 2,200 used to be clipped to "200" at 28px: four characters need more.
    const four = burnAxisWidth(2200);
    expect(four).toBeGreaterThanOrEqual(4 * 7 + 10);
    // 8,000 still has four-character ticks though its headroom reads "10K".
    expect(burnAxisWidth(8000)).toBe(four);
    expect(burnAxisWidth(500)).toBeLessThan(four);
    for (const max of [5, 99, 999, 2200, 9999, 50_000, 2_000_000]) {
      const longest = Math.max(
        burnAxisTick(Math.ceil(max)).length,
        burnAxisTick(Math.ceil(max * 1.25)).length,
      );
      expect(burnAxisWidth(max)).toBeGreaterThanOrEqual(longest * 7 + 10);
    }
  });
});
