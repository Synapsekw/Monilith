import { itemDateRange } from "@/lib/boards/dates";
import { addDaysISO, diffDaysISO } from "@/lib/boards/calendar";
import type { CacheCellValue } from "@/lib/boards/cache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GanttRow = {
  itemId: string;
  name: string;
  scheduled: boolean;
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
  value: { date: string; end: string };
};

// ---------------------------------------------------------------------------
// buildGanttRows
// ---------------------------------------------------------------------------

/**
 * Build one GanttRow per item using a date column's cell values.
 *
 * @param items          Board items (must have id + name)
 * @param cellValues     All cell values for this board
 * @param dateColumnId   The date column to read from
 * @param rangeStartISO  The first day displayed in the Gantt (YYYY-MM-DD)
 * @param dayCount       Total visible days (accepted for signature compat)
 * @param zoom           Zoom level (accepted for signature compat)
 */
export function buildGanttRows(
  items: { id: string; name: string }[],
  cellValues: CacheCellValue[],
  dateColumnId: string,
  rangeStartISO: string,
  dayCount: number,
  zoom: string,
): { rows: GanttRow[] } {
  void dayCount;
  void zoom;

  const rows: GanttRow[] = items.map((item) => {
    const range = itemDateRange(item.id, cellValues, dateColumnId);

    if (!range) {
      return { itemId: item.id, name: item.name, scheduled: false };
    }

    const startCol = diffDaysISO(rangeStartISO, range.start);
    const spanCols = diffDaysISO(range.start, range.end) + 1;
    const isMilestone = range.start === range.end;

    return {
      itemId: item.id,
      name: item.name,
      scheduled: true,
      startCol,
      spanCols,
      isMilestone,
      startISO: range.start,
      endISO: range.end,
    };
  });

  return { rows };
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
 * Shift both start and end of a bar by deltaDays (positive = forward,
 * negative = backward).
 */
export function onBarMoved(
  itemId: string,
  deltaDays: number,
  range: { start: string; end: string },
  dateColumnId: string,
  setCell: (arg: SetCellArg) => void,
): void {
  const newStart = addDaysISO(range.start, deltaDays);
  const newEnd = addDaysISO(range.end, deltaDays);
  setCell({
    itemId,
    columnId: dateColumnId,
    value: { date: newStart, end: newEnd },
  });
}

// ---------------------------------------------------------------------------
// onBarResized
// ---------------------------------------------------------------------------

/**
 * Update only the end date of a bar (right-edge resize).
 * Start date is preserved from the current range.
 */
export function onBarResized(
  itemId: string,
  newEndISO: string,
  range: { start: string; end: string },
  dateColumnId: string,
  setCell: (arg: SetCellArg) => void,
): void {
  setCell({
    itemId,
    columnId: dateColumnId,
    value: { date: range.start, end: newEndISO },
  });
}
