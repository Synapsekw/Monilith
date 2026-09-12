import { describe, it, expect } from "vitest";
import {
  clampDragWidth,
  fitNameColumnWidth,
  NAME_COL_MIN,
  NAME_COL_MAX,
  NAME_COL_AUTOFIT_MAX,
} from "@/lib/boards/name-column-width";

// stub measurer: 7px per char (real canvas measureText returns 0 in jsdom)
const measure = (s: string) => s.length * 7;

// The real, measured chrome reserves fitNameColumnWidth adds on top of the
// text width (see the constants' own comments for how these were measured).
const TOP_LEVEL_EDITOR_CHROME = 197;
const TOP_LEVEL_VIEWER_CHROME = 173;
const SUBITEM_CHROME = 129;

describe("fitNameColumnWidth", () => {
  it("clamps a short subitem name to the floor (text + its chrome is still under it)", () => {
    // "abcdef" → 42px text + 129px subitem chrome = 171 < NAME_COL_MIN (180)
    const short = "abcdef";
    expect(short.length * 7 + 129).toBeLessThan(NAME_COL_MIN); // sanity
    expect(
      fitNameColumnWidth([{ name: short, indented: true }], measure, true),
    ).toBe(NAME_COL_MIN);
  });

  it("a top-level row's own chrome alone can exceed the floor even for a tiny name", () => {
    // The real top-level chrome (197 for an editor) is bigger than the floor
    // (180) on its own — unlike the old flat 60px PADDING, a short top-level
    // name no longer risks being measured as narrower than its own chrome.
    expect(fitNameColumnWidth([{ name: "a" }], measure, true)).toBe(7 + 197);
  });

  it("grows a top-level (editor) name by exactly text width + measured chrome", () => {
    const long = "x".repeat(60); // 420px text
    const expected = 420 + TOP_LEVEL_EDITOR_CHROME;
    expect(expected).toBeGreaterThan(NAME_COL_MIN); // sanity: not floor-clamped
    expect(fitNameColumnWidth([{ name: long }], measure, true)).toBe(expected);
  });

  it("reserves less chrome for a viewer (no bulk-select checkbox)", () => {
    const long = "x".repeat(60);
    const editorWidth = fitNameColumnWidth([{ name: long }], measure, true);
    const viewerWidth = fitNameColumnWidth([{ name: long }], measure, false);
    expect(editorWidth - viewerWidth).toBe(
      TOP_LEVEL_EDITOR_CHROME - TOP_LEVEL_VIEWER_CHROME,
    );
    expect(viewerWidth).toBe(420 + TOP_LEVEL_VIEWER_CHROME);
  });

  it("reserves the indented subitem chrome (its pl-10 indent) for a subitem-length name", () => {
    const long = "x".repeat(60); // 420px text
    const topLevel = fitNameColumnWidth(
      [{ name: long, indented: false }],
      measure,
      true,
    );
    const subitem = fitNameColumnWidth(
      [{ name: long, indented: true }],
      measure,
      true,
    );
    // Same text, different row shape — the deltas must be EXACTLY the
    // measured chrome deltas, not a restated guess.
    expect(subitem).toBe(420 + SUBITEM_CHROME);
    expect(topLevel - subitem).toBe(TOP_LEVEL_EDITOR_CHROME - SUBITEM_CHROME);
  });

  it("picks the widest across a mix of top-level and subitem names", () => {
    // The subitem name is longer once its own chrome is added, even though
    // the raw top-level name is longer as plain text.
    const items = [
      { name: "x".repeat(50), indented: false }, // 350 + 197 = 547
      { name: "x".repeat(48), indented: true }, //  336 + 129 = 465
    ];
    const widest = Math.max(
      50 * 7 + TOP_LEVEL_EDITOR_CHROME,
      48 * 7 + SUBITEM_CHROME,
    );
    expect(fitNameColumnWidth(items, measure, true)).toBe(widest);
  });

  it("clamps to the tighter auto-fit ceiling, not the drag-resize max", () => {
    const huge = "x".repeat(1000);
    expect(fitNameColumnWidth([{ name: huge }], measure, true)).toBe(
      NAME_COL_AUTOFIT_MAX,
    );
    // The auto-fit ceiling is strictly tighter than the manual-resize ceiling
    // — a user can still drag past it.
    expect(NAME_COL_AUTOFIT_MAX).toBeLessThan(NAME_COL_MAX);
  });

  it("falls back to the floor for no items", () => {
    expect(fitNameColumnWidth([], measure, true)).toBe(NAME_COL_MIN);
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

  it("still allows a manual drag past the auto-fit ceiling, up to NAME_COL_MAX", () => {
    expect(clampDragWidth(900, NAME_COL_MIN, NAME_COL_MAX)).toBe(900);
    expect(900).toBeGreaterThan(NAME_COL_AUTOFIT_MAX);
  });
});
