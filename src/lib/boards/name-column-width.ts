/** Bounds for the built-in Name column. MAX mirrors the configurable-column
 *  resize handle (ColumnHeader) and the DB check constraint — a ceiling for a
 *  user's deliberate drag, not a target for auto-fit (see `fitNameColumnWidth`,
 *  which clamps auto-fit tighter). MIN is the auto-fit floor — enough for the
 *  "Name" header label and the open-panel control. */
export const NAME_COL_MIN = 180;
export const NAME_COL_MAX = 1200;

/**
 * Auto-fit ceiling, tighter than {@link NAME_COL_MAX}. An auto-fit column
 * exists to make the *typical* longest name legible without truncation, not
 * to let one absurdly long name (a pasted paragraph, say) swallow the whole
 * table on first paint — the user can still drag past this via the resize
 * handle, which clamps to NAME_COL_MAX. 640px comfortably fits the widest
 * realistic item name (~70-80 chars at the Name-cell font) plus its chrome
 * with room to spare, while leaving most of a typical viewport for the value
 * columns.
 */
export const NAME_COL_AUTOFIT_MAX = 640;

/**
 * Reserved chrome around the name text in a TOP-LEVEL row, for an editor, on a
 * fine pointer. The sum of, left to right: the cell's `pl-1` (4) + drag handle
 * `w-4` (16) + bulk-select checkbox `size-5` (20) + the name's own `pl-1` +
 * `pr-2` (4 + 8) + the permanent 1px `NAME_FREEZE_RULE` border. Total 53.
 *
 * The open-panel, add-subitem and row-menu buttons are NOT in this sum. They
 * are an overlay on the cell's right edge (see NameCell) and take no width, so
 * an auto-fitted column is as wide as its longest name needs and no wider.
 *
 * These are sums of the class widths, not a browser measurement. The
 * orchestrator confirms them against the built CSS before merge (plan:
 * "Browser verification"); if a class in NameCell / ItemRow changes, change
 * the matching number here.
 */
export const TOP_LEVEL_CHROME_EDITOR = 53;

/** Same row, for a viewer: no bulk-select checkbox (53 − 20). */
export const TOP_LEVEL_CHROME_VIEWER = 33;

/**
 * Extra reserve on top-level rows when the board has at least one subitem: the
 * chevron slot `size-5` (20) every row then carries, plus the "(n)" child
 * count a parent row shows beside it (`ml-1` 4 + up to "(99)" at 12px ≈ 24).
 * Reserved on every top-level row of such a board — a superset, like the
 * add-subitem reserve this replaces — because the fit list does not say which
 * rows are parents.
 */
export const SUBITEM_SLOT_CHROME = 48;

/**
 * Reserved chrome around the name text in a SUBITEM row: the cell's `pl-1`
 * (4) + drag handle (16) + the name's `pl-10` indent (40) + `pr-2` (8) + the
 * 1px `NAME_FREEZE_RULE` border. Total 69. The thread line is absolutely
 * positioned and takes no width.
 */
export const SUBITEM_CHROME = 69;

/**
 * Coarse-pointer (touch) chrome. On a coarse pointer the hover overlay goes
 * in flow (`pointer-coarse:static`) and every control is 44px
 * (`pointer-coarse:size-11`), so they take real width from the name.
 *
 * Top-level, editor: the cell's `pl-1` (4) + `pointer-coarse:pr-2` (8) + drag
 * handle (44) + bulk-select checkbox (44) + the name's `pl-1` + `pr-2` (12) +
 * the 1px freeze rule = 113, plus the in-flow actions: open-panel (44) +
 * add-subitem (44, childless rows only, reserved on every row as a superset)
 * + row menu (44) = 132. Total 245.
 */
export const COARSE_TOP_LEVEL_CHROME_EDITOR = 245;

/** Same row, for a viewer: no bulk-select checkbox (245 − 44). */
export const COARSE_TOP_LEVEL_CHROME_VIEWER = 201;

/**
 * Subitem row on a coarse pointer: cell `pl-1` (4) + `pr-2` (8) + drag handle
 * (44) + the name's `pl-10` + `pr-2` (48) + 1px rule = 105, plus in-flow
 * open-panel (44) + row menu (44) = 88. Total 193. (The chevron slot is
 * `size-5` on every pointer, so `SUBITEM_SLOT_CHROME` is shared.)
 */
export const COARSE_SUBITEM_CHROME = 193;

/**
 * Round + clamp a dragged column width to an integer in `[min, max]`. The resize
 * server actions validate `z.number().int()`, so a fractional pointer delta — a
 * sub-pixel `clientX` under browser zoom or fractional display scaling — must be
 * rounded before it reaches the action. Otherwise the mutation throws, rolls back
 * the optimistic cache, and the column snaps back to its prior width.
 */
export function clampDragWidth(
  value: number,
  min: number,
  max: number,
): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

/** One item's name plus what its row shape needs, for {@link fitNameColumnWidth}. */
export type NameColumnFitItem = {
  name: string;
  /** True for a subitem row (rendered indented under its expanded parent) —
   *  reserves {@link SUBITEM_CHROME} instead of the top-level chrome. */
  indented?: boolean;
};

/**
 * Auto-fit width for the Name column: the widest (measured name + that row's
 * real chrome) across every item — top-level AND subitem — clamped to
 * [NAME_COL_MIN, NAME_COL_AUTOFIT_MAX]. `measure` is injected (an offscreen
 * canvas `measureText` in the browser) so the function stays pure and
 * unit-testable — jsdom's real `measureText` returns 0. `canEdit` selects
 * between the editor and viewer top-level chrome reserve (the bulk-select
 * checkbox only renders for editors); it has no effect on subitem rows, which
 * never carry that checkbox either way. A subitem anywhere in `items` adds the
 * chevron-slot reserve to every top-level row (see `SUBITEM_SLOT_CHROME`).
 * `coarse` (touch pointer, default false) swaps in the in-flow 44px chrome.
 */
export function fitNameColumnWidth(
  items: readonly NameColumnFitItem[],
  measure: (text: string) => number,
  canEdit: boolean,
  coarse = false,
): number {
  const hasSubitems = items.some((it) => it.indented === true);
  const editorChrome = coarse
    ? COARSE_TOP_LEVEL_CHROME_EDITOR
    : TOP_LEVEL_CHROME_EDITOR;
  const viewerChrome = coarse
    ? COARSE_TOP_LEVEL_CHROME_VIEWER
    : TOP_LEVEL_CHROME_VIEWER;
  const subitemChrome = coarse ? COARSE_SUBITEM_CHROME : SUBITEM_CHROME;
  const topLevelChrome =
    (canEdit ? editorChrome : viewerChrome) +
    (hasSubitems ? SUBITEM_SLOT_CHROME : 0);
  let widest = 0;
  for (const { name, indented } of items) {
    const chrome = indented ? subitemChrome : topLevelChrome;
    const w = Math.ceil(measure(name)) + chrome;
    if (w > widest) widest = w;
  }
  return Math.min(NAME_COL_AUTOFIT_MAX, Math.max(NAME_COL_MIN, widest));
}
