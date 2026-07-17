import { resolveTimelineSpan } from "@/lib/boards/dates";
import { bucketItems } from "@/lib/boards/item-tree";
import { addDaysISO, diffDaysISO } from "@/lib/boards/calendar";
import type { CacheCellValue, CacheItem } from "@/lib/boards/cache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GanttRow = {
  itemId: string;
  name: string;
  scheduled: boolean;
  /** null for a top-level item, the parent's id for a sub-item. */
  parentId?: string | null;
  /** 0 for a top-level row, 1 for a sub-item row (boards nest one level). */
  depth?: number;
  /** True on a parent that has at least one scheduled sub-item to reveal. */
  hasChildren?: boolean;
  /** Number of scheduled sub-items nested under this parent. */
  childCount?: number;
  startCol?: number;
  spanCols?: number;
  isMilestone?: boolean;
  startISO?: string;
  endISO?: string;
};

export type GanttDependency = {
  id: string;
  predecessor_id: string;
  successor_id: string;
};

export type SetCellArg = {
  itemId: string;
  columnId: string;
  value: { date: string; end?: string };
};

/**
 * Days the timeline grid must cover. At least `floorDays` (the zoom window),
 * extended to fit the latest date (inclusive) plus a few days of padding so
 * bars beyond the zoom window aren't clipped off-screen. Capped at ~10 years so
 * a typo'd far-future date can't blow up the grid width.
 */
export function timelineDayCount(
  rangeStartISO: string,
  rangeEndISO: string,
  floorDays: number,
): number {
  if (!rangeStartISO || !rangeEndISO) return floorDays;
  const PAD = 3;
  const MAX = 3660; // ~10 years
  const span = diffDaysISO(rangeStartISO, rangeEndISO) + 1 + PAD;
  return Math.min(MAX, Math.max(floorDays, span));
}

// ---------------------------------------------------------------------------
// buildGanttRows
// ---------------------------------------------------------------------------

/**
 * Build one GanttRow per item using a start (and optional end) date column.
 * Rows come out in nested order — each top-level item immediately followed by
 * its sub-items (both sorted by position, via {@link bucketItems}) — and carry
 * `depth`/`parentId` so the name rail can indent, plus `hasChildren`/`childCount`
 * (scheduled sub-items only) so a parent can render an expand/collapse toggle.
 *
 * @param items          Board items (id, name, parent_id, position)
 * @param cellValues     All cell values for this board (may include synthetic
 *                       created/updated-at cells — see syntheticDateCellValues)
 * @param startColumnId  The date source supplying the start (and end when endColumnId is null)
 * @param endColumnId    When non-null, a separate source supplying the end date
 * @param rangeStartISO  The first day displayed in the Gantt (YYYY-MM-DD)
 * @param dayCount       Total visible days (accepted for signature compat)
 * @param zoom           Zoom level (accepted for signature compat)
 */
export function buildGanttRows(
  items: readonly CacheItem[],
  cellValues: CacheCellValue[],
  startColumnId: string,
  endColumnId: string | null,
  rangeStartISO: string,
  dayCount: number,
  zoom: string,
): { rows: GanttRow[] } {
  void dayCount;
  void zoom;

  const makeRow = (item: CacheItem, depth: number): GanttRow => {
    const span = resolveTimelineSpan(
      item.id,
      cellValues,
      startColumnId,
      endColumnId,
    );
    const base: GanttRow = {
      itemId: item.id,
      name: item.name,
      parentId: item.parent_id ?? null,
      depth,
      scheduled: !!span,
    };
    if (!span) return base;
    return {
      ...base,
      startCol: diffDaysISO(rangeStartISO, span.start),
      spanCols: diffDaysISO(span.start, span.end) + 1,
      isMilestone: span.isMilestone,
      startISO: span.start,
      endISO: span.end,
    };
  };

  const { topLevel, childrenByParent } = bucketItems(items);
  const rows: GanttRow[] = [];
  for (const top of topLevel) {
    const childRows = (childrenByParent.get(top.id) ?? []).map((c) =>
      makeRow(c, 1),
    );
    const scheduledChildCount = childRows.filter((r) => r.scheduled).length;
    const topRow = makeRow(top, 0);
    topRow.hasChildren = scheduledChildCount > 0;
    topRow.childCount = scheduledChildCount;
    rows.push(topRow, ...childRows);
  }

  return { rows };
}

/**
 * Filter nested rows to those currently visible: every top-level row, plus a
 * sub-item row only when its parent id is in `expanded`. Pure — the single
 * source of truth for collapse in the timeline (used for virtualization, the
 * rows-area height, and dependency-arrow indexing).
 */
export function visibleRows(
  rows: readonly GanttRow[],
  expanded: ReadonlySet<string>,
): GanttRow[] {
  return rows.filter((r) => !r.parentId || expanded.has(r.parentId));
}

// ---------------------------------------------------------------------------
// detectViolations
// ---------------------------------------------------------------------------

/**
 * Return a Set of dependency ids where the successor starts before its
 * predecessor ends (a scheduling violation).
 */
export function detectViolations(
  rows: GanttRow[],
  deps: GanttDependency[],
): Set<string> {
  const rowMap = new Map<string, GanttRow>(rows.map((r) => [r.itemId, r]));
  const violations = new Set<string>();

  for (const dep of deps) {
    const predecessor = rowMap.get(dep.predecessor_id);
    const successor = rowMap.get(dep.successor_id);

    if (
      !predecessor?.scheduled ||
      !successor?.scheduled ||
      predecessor.endISO === undefined ||
      successor.startISO === undefined
    ) {
      continue;
    }

    // ISO string comparison works correctly for YYYY-MM-DD dates
    if (successor.startISO < predecessor.endISO) {
      violations.add(dep.id);
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// onBarMoved
// ---------------------------------------------------------------------------

/**
 * Shift a bar by deltaDays. With a separate end column, writes the new start to
 * the start column and the new end to the end column. In legacy single-column
 * mode (endColumnId null), writes { date, end } to the start column.
 */
export function onBarMoved(
  itemId: string,
  deltaDays: number,
  range: { start: string; end: string },
  startColumnId: string,
  endColumnId: string | null,
  setCell: (arg: SetCellArg) => void,
): void {
  const newStart = addDaysISO(range.start, deltaDays);
  const newEnd = addDaysISO(range.end, deltaDays);
  if (endColumnId) {
    setCell({ itemId, columnId: startColumnId, value: { date: newStart } });
    setCell({ itemId, columnId: endColumnId, value: { date: newEnd } });
  } else {
    setCell({
      itemId,
      columnId: startColumnId,
      value: { date: newStart, end: newEnd },
    });
  }
}

// ---------------------------------------------------------------------------
// onBarResized
// ---------------------------------------------------------------------------

/**
 * Update the end of a bar (right-edge resize). With a separate end column,
 * writes only the end column. In legacy single-column mode, writes
 * { date: range.start, end: newEndISO } to the start column.
 */
export function onBarResized(
  itemId: string,
  newEndISO: string,
  range: { start: string; end: string },
  startColumnId: string,
  endColumnId: string | null,
  setCell: (arg: SetCellArg) => void,
): void {
  if (endColumnId) {
    setCell({ itemId, columnId: endColumnId, value: { date: newEndISO } });
  } else {
    setCell({
      itemId,
      columnId: startColumnId,
      value: { date: range.start, end: newEndISO },
    });
  }
}
