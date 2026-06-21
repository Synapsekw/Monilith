import { describe, it, expect } from "vitest";
import {
  clampDragWidth,
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

describe("clampDragWidth", () => {
  // The resize server actions validate `z.number().int()` — a fractional pointer
  // delta (sub-pixel clientX under browser zoom / fractional display scaling)
  // would be rejected, throwing the mutation and snapping the column back. This
  // helper guarantees an in-range integer reaches the action.
  it("rounds a fractional width to an integer", () => {
    expect(clampDragWidth(347.5, 80, 1200)).toBe(348);
    expect(clampDragWidth(347.4, 80, 1200)).toBe(347);
    expect(Number.isInteger(clampDragWidth(212.0001, 80, 1200))).toBe(true);
  });

  it("clamps below the floor and above the ceiling", () => {
    expect(clampDragWidth(40.6, 80, 1200)).toBe(80);
    expect(clampDragWidth(5000.9, 80, 1200)).toBe(1200);
  });

  it("passes an already-integer in-range width through unchanged", () => {
    expect(clampDragWidth(300, 80, 1200)).toBe(300);
  });
});
