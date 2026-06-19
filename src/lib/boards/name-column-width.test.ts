import { describe, it, expect } from "vitest";
import {
  fitNameColumnWidth,
  NAME_COL_MIN,
  NAME_COL_MAX,
} from "@/lib/boards/name-column-width";

// stub measurer: 7px per char (real canvas measureText returns 0 in jsdom)
const measure = (s: string) => s.length * 7;

describe("fitNameColumnWidth", () => {
  it("fits the longest name plus padding, clamped to the floor", () => {
    // longest = "abcd" → 28px + padding < floor → floor
    expect(fitNameColumnWidth(["a", "abcd"], measure)).toBe(NAME_COL_MIN);
  });

  it("grows with a long name", () => {
    const long = "x".repeat(60); // 420 + 60 padding = 480
    expect(fitNameColumnWidth([long], measure)).toBe(480);
  });

  it("clamps to the max", () => {
    const huge = "x".repeat(1000);
    expect(fitNameColumnWidth([huge], measure)).toBe(NAME_COL_MAX);
  });

  it("falls back to the floor for no names", () => {
    expect(fitNameColumnWidth([], measure)).toBe(NAME_COL_MIN);
  });
});
