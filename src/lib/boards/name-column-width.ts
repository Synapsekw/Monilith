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
 * Reserved chrome around the name text in a TOP-LEVEL row, for an editor
 * (bulk-select checkbox shown). Measured against the real compiled markup —
 * see `.superpowers/name-width-report.md` — as the sum of, left to right:
 * bulk-select checkbox (`size-6` = 24) + drag handle (`size-6` = 24) + expand
 * chevron / spacer (`size-6` = 24, both branches the same width) + the name
 * div's own `px-4` padding (16 + 16 = 32) + open-panel button (`size-7` = 28)
 * + add-subitem button (`size-7` = 28) + row-menu button (`size-7` = 28) +
 * the cell wrapper's own `pr-2` (8) + the permanent 1px `NAME_FREEZE_RULE`
 * right border. Total measured: 197.
 *
 * The add-subitem button only renders when the row has NO children yet
 * (`childCount === 0`); a row WITH children swaps it for a smaller
 * "(n)" child-count label in the leading group instead (measured total 190
 * for a single-digit count) — reserving for the no-children case is the safe
 * superset for both.
 */
const TOP_LEVEL_CHROME_EDITOR = 197;

/** Same row, for a viewer: no bulk-select checkbox (measured total 173). */
const TOP_LEVEL_CHROME_VIEWER = 173;

/**
 * Reserved chrome around the name text in a SUBITEM row (indented under an
 * expanded parent). Measured total: drag handle (`size-6` = 24 — the
 * parent↔child thread line itself is absolutely positioned and takes no flex
 * width) + the name div's own `pl-10` indent (40, no matching right padding)
 * + open-panel button (`size-7` = 28) + row-menu button (`size-7` = 28) + the
 * cell wrapper's own `pr-2` (8) + the 1px `NAME_FREEZE_RULE` border. Total
 * measured: 129. Subitem rows have no bulk-select checkbox, expand chevron,
 * or add-subitem button — see SortableSubitemRow.
 */
const SUBITEM_CHROME = 129;

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
 * never carry that checkbox either way.
 */
export function fitNameColumnWidth(
  items: readonly NameColumnFitItem[],
  measure: (text: string) => number,
  canEdit: boolean,
): number {
  const topLevelChrome = canEdit
    ? TOP_LEVEL_CHROME_EDITOR
    : TOP_LEVEL_CHROME_VIEWER;
  let widest = 0;
  for (const { name, indented } of items) {
    const chrome = indented ? SUBITEM_CHROME : topLevelChrome;
    const w = Math.ceil(measure(name)) + chrome;
    if (w > widest) widest = w;
  }
  return Math.min(NAME_COL_AUTOFIT_MAX, Math.max(NAME_COL_MIN, widest));
}
