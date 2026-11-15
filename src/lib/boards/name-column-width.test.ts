import { describe, it, expect } from "vitest";
import {
  clampDragWidth,
  fitNameColumnWidth,
  NAME_COL_MIN,
  NAME_COL_MAX,
  NAME_COL_AUTOFIT_MAX,
  COARSE_SUBITEM_CHROME,
  COARSE_TOP_LEVEL_CHROME_EDITOR,
  COARSE_TOP_LEVEL_CHROME_VIEWER,
  SUBITEM_CHROME,
  SUBITEM_SLOT_CHROME,
  TOP_LEVEL_CHROME_EDITOR,
  TOP_LEVEL_CHROME_VIEWER,
} from "@/lib/boards/name-column-width";

// stub measurer: 7px per char (real canvas measureText returns 0 in jsdom)
const measure = (s: string) => s.length * 7;

describe("name-cell chrome reserves", () => {
  it("are the dense gutter sums, with no hover buttons in them", () => {
    // cell pl-1 (4) + drag handle w-4 (16) + checkbox size-5 (20)
    // + name pl-1 + pr-2 (12) + NAME_FREEZE_RULE border (1)
    expect(TOP_LEVEL_CHROME_EDITOR).toBe(53);
    // same, without the checkbox
    expect(TOP_LEVEL_CHROME_VIEWER).toBe(33);
    // chevron size-5 (20) + "(n)" label: ml-1 (4) + up to "(99)" (24)
    expect(SUBITEM_SLOT_CHROME).toBe(48);
    // cell pl-1 (4) + drag handle (16) + name pl-10 (40) + pr-2 (8) + border (1)
    expect(SUBITEM_CHROME).toBe(69);
  });
});

describe("coarse-pointer chrome reserves", () => {
  it("are the sums of the 44px in-flow controls", () => {
    // cell pl-1 4 + pr-2 8 + handle 44 + checkbox 44 + name pl-1/pr-2 12
    // + border 1 = 113, + open/add-subitem/menu in flow 3 x 44 = 245
    expect(COARSE_TOP_LEVEL_CHROME_EDITOR).toBe(245);
    expect(COARSE_TOP_LEVEL_CHROME_VIEWER).toBe(201);
    // 4 + 8 + 44 + name pl-10/pr-2 48 + 1 = 105, + open + menu 88
    expect(COARSE_SUBITEM_CHROME).toBe(193);
  });
});

describe("fitNameColumnWidth", () => {
  it("coarse reserves the wider in-flow chrome; fine is unchanged", () => {
    const long = "x".repeat(40); // 280px
    expect(fitNameColumnWidth([{ name: long }], measure, true)).toBe(333);
    expect(fitNameColumnWidth([{ name: long }], measure, true, false)).toBe(
      333,
    );
    expect(fitNameColumnWidth([{ name: long }], measure, true, true)).toBe(
      280 + COARSE_TOP_LEVEL_CHROME_EDITOR,
    );
    expect(fitNameColumnWidth([{ name: long }], measure, false, true)).toBe(
      280 + COARSE_TOP_LEVEL_CHROME_VIEWER,
    );
    expect(
      fitNameColumnWidth([{ name: long, indented: true }], measure, true, true),
    ).toBe(280 + COARSE_SUBITEM_CHROME);
  });

  it("coarse adds the chevron reserve on a board with subitems", () => {
    const items = [{ name: "x".repeat(40) }, { name: "s", indented: true }];
    expect(fitNameColumnWidth(items, measure, true, true)).toBe(
      280 + COARSE_TOP_LEVEL_CHROME_EDITOR + SUBITEM_SLOT_CHROME,
    );
  });

  it("clamps a short subitem name to the floor", () => {
    // "abcdef" → 42px text + 69px subitem chrome = 111 < NAME_COL_MIN (180)
    expect(
      fitNameColumnWidth([{ name: "abcdef", indented: true }], measure, true),
    ).toBe(NAME_COL_MIN);
  });

  it("clamps a tiny top-level name to the floor now that the hover buttons are not reserved", () => {
    // 7 + 53 = 60. Before this change the chrome alone (197) beat the floor.
    expect(fitNameColumnWidth([{ name: "a" }], measure, true)).toBe(
      NAME_COL_MIN,
    );
  });

  it("grows a top-level (editor) name by exactly text width + chrome", () => {
    const long = "x".repeat(60); // 420px text
    expect(fitNameColumnWidth([{ name: long }], measure, true)).toBe(
      420 + TOP_LEVEL_CHROME_EDITOR,
    );
  });

  it("no longer counts the three hover buttons", () => {
    // The old reserve was 197 (it held 92px open for open / add / menu).
    const name = "x".repeat(40); // 280px text
    const width = fitNameColumnWidth([{ name }], measure, true);
    expect(width).toBe(280 + 53);
    expect(width).toBeLessThan(280 + 197 - 92);
  });

  it("reserves less chrome for a viewer (no bulk-select checkbox)", () => {
    const long = "x".repeat(60);
    const editorWidth = fitNameColumnWidth([{ name: long }], measure, true);
    const viewerWidth = fitNameColumnWidth([{ name: long }], measure, false);
    expect(editorWidth - viewerWidth).toBe(20);
    expect(viewerWidth).toBe(420 + TOP_LEVEL_CHROME_VIEWER);
  });

  it("reserves the chevron slot on top-level rows only when the board has a subitem", () => {
    const long = "x".repeat(60); // 420px text
    const without = fitNameColumnWidth([{ name: long }], measure, true);
    const withSub = fitNameColumnWidth(
      [{ name: long }, { name: "s", indented: true }],
      measure,
      true,
    );
    expect(withSub - without).toBe(SUBITEM_SLOT_CHROME);
  });

  it("reserves the indented subitem chrome for a subitem-length name", () => {
    const long = "x".repeat(60); // 420px text
    expect(
      fitNameColumnWidth([{ name: long, indented: true }], measure, true),
    ).toBe(420 + SUBITEM_CHROME);
  });

  it("picks the widest across a mix of top-level and subitem names", () => {
    const items = [
      { name: "x".repeat(50), indented: false }, // 350 + 53 + 48 = 451
      { name: "x".repeat(48), indented: true }, //  336 + 69      = 405
    ];
    expect(fitNameColumnWidth(items, measure, true)).toBe(451);
  });

  it("clamps to the tighter auto-fit ceiling, not the drag-resize max", () => {
    const huge = "x".repeat(1000);
    expect(fitNameColumnWidth([{ name: huge }], measure, true)).toBe(
      NAME_COL_AUTOFIT_MAX,
    );
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
