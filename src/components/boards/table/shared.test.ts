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
