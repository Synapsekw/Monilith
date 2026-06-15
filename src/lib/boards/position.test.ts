import { describe, expect, it } from "vitest";
import { midpoint } from "./position";

describe("midpoint", () => {
  it("returns max+1 when appending to the end (no next)", () => {
    expect(midpoint(4, null)).toBe(5);
  });

  it("returns half when prepending to the start (no prev)", () => {
    expect(midpoint(null, 2)).toBe(1);
  });

  it("returns the average of two neighbours", () => {
    expect(midpoint(2, 4)).toBe(3);
  });

  it("returns 0 for the very first position (no neighbours)", () => {
    expect(midpoint(null, null)).toBe(0);
  });

  it("handles fractional neighbours", () => {
    expect(midpoint(1, 1.5)).toBe(1.25);
  });
});
