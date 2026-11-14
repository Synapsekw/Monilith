import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cellKey,
  type BoardCache,
  type CacheCellValue,
} from "@/lib/boards/cache";
import {
  CACHE_SLICES,
  cellControlsEqual,
  rowCellsEqual,
  type CellControls,
  gridTemplate,
  resolveColumnWidth,
} from "./shared";

function emptyCache(): BoardCache {
  return {
    board: { id: "b1" } as BoardCache["board"],
    groups: [],
    columns: [],
    items: [],
    cellValues: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  };
}

const noop = () => {};
// Shared identities: the bundle is compared field-by-field, so a fixture that
// allocated these per call would differ for reasons the test isn't about.
const members: CellControls["members"] = [];
const dependentsByItem: CellControls["dependentsByItem"] = new Map();

function makeControls(cache: BoardCache): CellControls {
  return {
    setEditing: noop,
    setCell: noop,
    clearCellValue: noop,
    members,
    boardId: "b1",
    currentUserId: "u1",
    addItem: noop,
    renameItemInCache: noop,
    addSubitem: noop,
    deleteItem: noop,
    reorderItem: noop,
    moveItemToGroup: noop,
    cache,
    dependentsByItem,
    statusColumn: null,
    uploadColumnFile: noop,
    openFilesLightbox: noop,
    filesPreviewUrls: undefined,
    filesThumbUrls: undefined,
    startTimer: noop,
    stopTimer: noop,
    addManualEntry: noop,
    editEntry: noop,
    deleteEntry: noop,
    setEstimate: noop,
    setRelationLinks: noop,
  };
}

describe("CACHE_SLICES", () => {
  it("covers every BoardCache slice except cellValues", () => {
    // A new slice on BoardCache must be added to CACHE_SLICES, or
    // `cellControlsEqual` would silently stop noticing when it changes.
    expect([...CACHE_SLICES].sort()).toEqual(
      Object.keys(emptyCache())
        .filter((k) => k !== "cellValues")
        .sort(),
    );
  });
});

describe("cellControlsEqual", () => {
  it("is true for the same object", () => {
    const controls = makeControls(emptyCache());
    expect(cellControlsEqual(controls, controls)).toBe(true);
  });

  it("ignores a cellValues-only cache change (rows compare their own cells)", () => {
    const cache = emptyCache();
    const a = makeControls(cache);
    const b = makeControls({
      ...cache,
      cellValues: [{ item_id: "i1" } as BoardCache["cellValues"][number]],
    });
    expect(cellControlsEqual(a, b)).toBe(true);
  });

  it("is false when any other cache slice changes identity", () => {
    const cache = emptyCache();
    const a = makeControls(cache);
    for (const slice of CACHE_SLICES) {
      const b = makeControls({ ...cache, [slice]: cache[slice] });
      // Spreading keeps identity, so force a fresh one for the slice under test.
      const changed = makeControls({
        ...b.cache,
        [slice]: Array.isArray(cache[slice]) ? [] : { ...cache[slice] },
      });
      expect(cellControlsEqual(a, changed), slice).toBe(false);
    }
  });

  it("is false when a callback or scalar field changes", () => {
    const cache = emptyCache();
    const a = makeControls(cache);
    const b = { ...makeControls(cache), setCell: () => {} };
    expect(cellControlsEqual(a, b)).toBe(false);
    const c = { ...makeControls(cache), currentUserId: "u2" };
    expect(cellControlsEqual(a, c)).toBe(false);
  });
});

describe("rowCellsEqual", () => {
  const columns = [{ id: "c1" }, { id: "c2" }];
  const base = new Map<string, CacheCellValue["value"]>([
    [cellKey("i1", "c1"), { text: "a" }],
    [cellKey("i1", "c2"), { text: "b" }],
    [cellKey("i2", "c1"), { text: "c" }],
    [cellKey("sub1", "c1"), { text: "s" }],
  ]);

  it("ignores changes to another row's cells", () => {
    const next = new Map(base);
    next.set(cellKey("i2", "c1"), { text: "changed" });
    expect(rowCellsEqual(base, next, ["i1"], columns)).toBe(true);
  });

  it("catches a change to one of the row's own cells", () => {
    const next = new Map(base);
    next.set(cellKey("i1", "c2"), { text: "changed" });
    expect(rowCellsEqual(base, next, ["i1"], columns)).toBe(false);
  });

  it("catches a change to a subitem the row rolls up", () => {
    const next = new Map(base);
    next.set(cellKey("sub1", "c1"), { text: "changed" });
    expect(rowCellsEqual(base, next, ["i1", "sub1"], columns)).toBe(false);
  });

  it("catches a cleared cell", () => {
    const next = new Map(base);
    next.delete(cellKey("i1", "c1"));
    expect(rowCellsEqual(base, next, ["i1"], columns)).toBe(false);
  });
});

import {
  COARSE_ROW_HEIGHT,
  ROW_HEIGHT,
  SUBITEM_ROW_HEIGHT,
  NAME_MEASURE_FONT,
  NAME_MEASURE_FONT_SIZE,
  buildNameMeasureFont,
  ROW_HAIRLINE,
} from "./shared";

describe("Quiet Grid geometry", () => {
  it("uses 28px item rows and 26px subitem rows, 44px on coarse pointers", () => {
    expect(ROW_HEIGHT).toBe(28);
    expect(SUBITEM_ROW_HEIGHT).toBe(26);
    expect(COARSE_ROW_HEIGHT).toBe(44);
  });

  it("measures the name column with the rendered name font", () => {
    // A drifted measurer silently mis-sizes the frozen column; typecheck and
    // jsdom both stay green, so this string is asserted explicitly.
    expect(NAME_MEASURE_FONT).toContain("13px");
    expect(NAME_MEASURE_FONT).toContain("Inter");
    expect(NAME_MEASURE_FONT).not.toContain("13.5px");
  });

  it("keeps the measuring size in step with the --text-item token", () => {
    // NameCell renders item names with `text-item`. The token lives in
    // globals.css as rem; the canvas measurer needs px. Read the real token so
    // changing one without the other fails here.
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const token = css.match(/--text-item:\s*([\d.]+)rem/);
    expect(token).not.toBeNull();
    expect(`${Number(token![1]) * 16}px`).toBe(NAME_MEASURE_FONT_SIZE);
  });

  it("scopes the 12.5px cell size to the board table and leaves the shared token alone", () => {
    // `text-cell` also renders in Kanban cards and the Calendar agenda (via
    // CellRenderer). Only the table goes to 12.5px.
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    expect(css).toMatch(/--text-cell:\s*0\.8125rem/);
    const scoped = css.match(
      /\[data-board-table\]\s+\.text-cell\s*\{\s*font-size:\s*([\d.]+)rem/,
    );
    expect(scoped).not.toBeNull();
    expect(Number(scoped![1]) * 16).toBe(12.5);
  });

  it("insets the row hairline so it starts at the name text", () => {
    expect(ROW_HAIRLINE).toContain("before:left-4");
    expect(ROW_HAIRLINE).not.toMatch(/\bborder-b\b/);
  });

  it("raises the row hairline above the frozen z-10 Name cell", () => {
    // Without this, the sticky/opaque Name cell (NameCell: `sticky left-0
    // z-10`) paints over the separator's `::before` for the width of the
    // Name column, since the row itself is only `relative` (z-auto) and
    // doesn't open its own stacking context — the pseudo and the sticky cell
    // compete directly. `before:z-20` matches the precedent in globals.css
    // for "rule above a z-10 frozen column" (`.intel-rule`'s host `::after`).
    expect(ROW_HAIRLINE).toContain("before:z-20");
  });

  it("keeps the row hairline clear of the frozen intel-rule lane (no notch)", () => {
    // Regression guard for a diagnosed-and-corrected claim in ROW_HAIRLINE's
    // own doc comment: raising the hairline's z-index above `.intel-rule`
    // does NOT put a notch in the Board Intelligence tone rule, because the
    // two boxes never share a horizontal pixel — the hairline starts at
    // `before:left-4` (16px) while `.intel-rule` (globals.css) is a 2px-wide
    // bar pinned at `left: 0`. This reads the ACTUAL width out of
    // globals.css (not a restated literal) so a future change that widens
    // `.intel-rule` past the hairline's inset fails here, not silently in
    // production.
    const globalsCssPath = path.join(process.cwd(), "src/app/globals.css");
    const css = fs.readFileSync(globalsCssPath, "utf8");
    const intelRuleBlock = css.match(/\.intel-rule\s*\{([^}]*)\}/);
    expect(intelRuleBlock).not.toBeNull();
    const widthMatch = intelRuleBlock![1].match(/width:\s*(\d+)px/);
    expect(widthMatch).not.toBeNull();
    const intelRuleWidthPx = Number(widthMatch![1]);

    // Tailwind v4's default spacing unit (`--spacing`) is 4px, unoverridden
    // in this app's theme (confirmed against the compiled CSS chunk) — so
    // `left-4` insets by 4 * 4 = 16px. `before:left-4` is asserted above.
    const TAILWIND_SPACING_UNIT_PX = 4;
    const hairlineInsetPx = 4 * TAILWIND_SPACING_UNIT_PX;

    expect(hairlineInsetPx).toBeGreaterThanOrEqual(intelRuleWidthPx);
  });

  describe("buildNameMeasureFont", () => {
    it("resolves the LIVE --font-inter family, not a bare literal", () => {
      // next/font self-hosts Inter under a generated family name exposed only
      // via --font-inter; a regression back to a hardcoded "Inter" literal
      // would make this assertion fail, since the generated name never
      // contains the substring "Inter" verbatim.
      const generated = "'__Inter_1a2b3c', '__Inter_Fallback_1a2b3c'";
      const font = buildNameMeasureFont(generated);
      expect(font).toContain(generated);
      expect(font).toContain("13px");
      expect(font).toContain("500");
      expect(font).not.toBe(NAME_MEASURE_FONT);
    });

    it("falls back to the NAME_MEASURE_FONT literal when the variable is empty", () => {
      // getComputedStyle returns "" for an unset custom property — true for
      // every jsdom test render, since next/font never runs there.
      expect(buildNameMeasureFont("")).toBe(NAME_MEASURE_FONT);
      expect(buildNameMeasureFont("   ")).toBe(NAME_MEASURE_FONT);
    });
  });
});

describe("column widths: live → saved → auto-fit → 180", () => {
  const column = (id: string, width: number | null) => ({ id, width });

  it("prefers the live drag width, then the saved width, then the fitted width", () => {
    expect(resolveColumnWidth(column("a", 240), { a: 310 }, { a: 96 })).toBe(
      310,
    );
    expect(resolveColumnWidth(column("a", 240), {}, { a: 96 })).toBe(240);
    expect(resolveColumnWidth(column("a", null), {}, { a: 96 })).toBe(96);
  });

  it("falls back to 180 before hydration, when nothing has been fitted", () => {
    expect(resolveColumnWidth(column("a", null), {}, {})).toBe(180);
    expect(resolveColumnWidth(column("a", null), {})).toBe(180);
  });

  it("builds the grid template from the same resolution", () => {
    const columns = [column("a", null), column("b", 240), column("c", null)];
    expect(gridTemplate(columns, { c: 200 }, 320, { a: 96, c: 120 })).toBe(
      "320px 96px 240px 200px 160px 176px 44px",
    );
  });

  it("keeps every unsaved column at 180 when no fitted widths are passed", () => {
    expect(gridTemplate([column("a", null)], {}, 320)).toBe(
      "320px 180px 160px 176px 44px",
    );
  });
});
