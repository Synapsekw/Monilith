import {
  defaultTimelineColumns,
  isSyntheticDateSource,
  type TimelineSpan,
} from "@/lib/boards/dates";

/** The subset of a timeline view's config that decides its date sources. */
export type TimelineViewConfig = {
  date_column_id?: string | null;
  end_column_id?: string | null;
} | null;

export type DateColumnRef = { id: string; name: string };

/** Which cells (or synthetic timestamp sources) a board's timeline reads. */
export type BoardSchedule = {
  startSourceId: string | null;
  endSourceId: string | null;
  /** True when a source is a synthetic timestamp — there is no cell to write. */
  readOnly: boolean;
};

/**
 * Resolve date sources from explicit picks. Mirrors GanttBoard's derivation:
 * a synthetic start keeps its sentinel; a real/unknown start falls back to the
 * first date column; the end pick is used as-is (null = no end column).
 */
export function scheduleFromPicks(
  dateColumns: readonly DateColumnRef[],
  startPick: string | null,
  endPick: string | null,
): BoardSchedule {
  const dateColumn =
    dateColumns.find((c) => c.id === startPick) ?? dateColumns[0] ?? null;
  const startSourceId = isSyntheticDateSource(startPick)
    ? startPick
    : (dateColumn?.id ?? null);
  const endSourceId = endPick;
  return {
    startSourceId,
    endSourceId,
    readOnly:
      isSyntheticDateSource(startSourceId) ||
      isSyntheticDateSource(endSourceId),
  };
}

/** A board's schedule from its (first) timeline view config, seeding unset picks by column name. */
export function resolveBoardSchedule(
  dateColumns: readonly DateColumnRef[],
  config: TimelineViewConfig,
): BoardSchedule {
  const seeded = defaultTimelineColumns([...dateColumns]);
  return scheduleFromPicks(
    dateColumns,
    config?.date_column_id ?? seeded.startColumnId,
    config?.end_column_id ?? seeded.endColumnId,
  );
}

/** Finish-to-start lateness — same rule as detectViolations. */
export function isLinkLate(
  pred: TimelineSpan | null,
  succ: TimelineSpan | null,
): boolean {
  if (!pred || !succ) return false;
  return succ.start < pred.end;
}
