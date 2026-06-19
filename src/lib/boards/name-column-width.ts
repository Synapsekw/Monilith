/** Bounds for the built-in Name column. MAX mirrors the configurable-column
 *  resize handle (ColumnHeader) and the DB check constraint. MIN is the auto-fit
 *  floor — enough for the "Name" header label and the open-panel control. */
export const NAME_COL_MIN = 180;
export const NAME_COL_MAX = 1200;

/** Cell chrome around the name text: px-4 left (16) + trailing open-panel button
 *  (size-7 = 28) + gap (~16). */
const PADDING = 60;

/**
 * Auto-fit width for the Name column: the widest measured item name plus cell
 * padding, clamped to [NAME_COL_MIN, NAME_COL_MAX]. `measure` is injected (an
 * offscreen canvas `measureText` in the browser) so the function stays pure and
 * unit-testable — jsdom's real `measureText` returns 0.
 */
export function fitNameColumnWidth(
  names: string[],
  measure: (text: string) => number,
): number {
  let widest = 0;
  for (const n of names) {
    const w = measure(n);
    if (w > widest) widest = w;
  }
  return Math.min(
    NAME_COL_MAX,
    Math.max(NAME_COL_MIN, Math.ceil(widest) + PADDING),
  );
}
