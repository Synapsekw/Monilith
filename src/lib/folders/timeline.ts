import type { CacheItem } from "@/lib/boards/cache";
import {
  crossBoardStubs,
  type ExternalLinkStub,
} from "@/lib/boards/cross-board";
import {
  isSyntheticDateSource,
  syntheticDateCellValues,
} from "@/lib/boards/dates";
import {
  buildGanttRows,
  detectViolations,
  rangeIncludingToday,
  spanOfRows,
  timelineDayCount,
  visibleRows,
  type GanttDependency,
  type GanttRow,
} from "@/lib/boards/gantt";
import {
  ZOOM_DAY_COUNT,
  todayISO,
  type TimelineZoom,
} from "@/components/boards/gantt/utils";
import {
  boardScheduleOf,
  contextCellValues,
  contextSpans,
  type FolderTimelineData,
  type TimelineItem,
} from "@/lib/boards/timeline-context";
import { ALL_ITEMS_KEY, stageKey } from "@/lib/folders/stages";
import type { RollupRow } from "@/lib/folders/types";

/** TanStack Query key for the folder Timeline tab's one payload. */
export const folderTimelineKey = (folderId: string) =>
  ["folder-timeline", folderId] as const;

export type FolderTimelineView = {
  rows: GanttRow[];
  dependencies: GanttDependency[];
  externalLinks: Map<string, ExternalLinkStub[]>;
  violations: Set<string>;
  rangeStartISO: string;
  dayCount: number;
  /** Item id → board id, for every item row in view. */
  boardOfItem: Map<string, string>;
  /** Boards shown as a band with nothing dated under it. */
  noDateBoards: Set<string>;
  /** Boards / items / late links on the chart under the current filters —
   * independent of which boards, groups or parents are open, so the header
   * doesn't jump and a closed folder still reports its late links. */
  totals: { boards: number; items: number; lateLinks: number };
};

type Counts = { total: number; done: number; overdue: number };

/** A band's progress from the folder rollup; unknown when no row matched. */
function progressOf(c: Counts | undefined): {
  donePct: number | null;
  lateCount: number | null;
} {
  if (!c) return { donePct: null, lateCount: null };
  return {
    donePct: c.total > 0 ? Math.round((c.done / c.total) * 100) : null,
    lateCount: c.overdue,
  };
}

/**
 * Lay a folder's boards out on one timeline, roll-up first: a band per board
 * (folder order); under an EXPANDED board a band per group; under an EXPANDED
 * group that group's scheduled items — each board read through its own date
 * sources. Every band carries a summary (the span of what is under it, plus
 * progress joined from the folder rollup by board id + group id), computed
 * whether or not the band is open. Links with both ends in view become arrows;
 * links to anything else become stubs on the local bar. Pure, so every zoom /
 * filter / expand toggle is a re-derive with no server round-trip.
 */
export function buildFolderTimeline(
  data: FolderTimelineData,
  opts: {
    stageKey: string | null;
    boardId: string | null;
    /** Parent items whose sub-items are shown. */
    expanded: ReadonlySet<string>;
    zoom: TimelineZoom;
    /** Boards showing their group bands. Empty = the roll-up view. */
    expandedBoards: ReadonlySet<string>;
    /** Groups showing their items. */
    expandedGroups: ReadonlySet<string>;
    /** Folder rollup rows, already filtered by stage/board by the caller. */
    rollup?: readonly RollupRow[];
    /** Injected in tests; defaults to the viewer's today. */
    todayISO?: string;
  },
): FolderTimelineView {
  const boards = new Map(data.boards.map((b) => [b.id, b]));
  const external = new Set(data.external_item_ids);
  const local = data.items.filter((i) => !external.has(i.id));
  const spans = contextSpans({ boards: data.boards, items: data.items });

  // One shared axis for every board: earliest local start to latest local
  // end, widened so today (− 14 / + 30 days) is always on the grid, and never
  // narrower than the zoom window.
  let min: string | null = null;
  let max: string | null = null;
  for (const it of local) {
    const s = spans.get(it.id);
    if (!s) continue;
    if (min === null || s.start < min) min = s.start;
    if (max === null || s.end > max) max = s.end;
  }
  const range = rangeIncludingToday(min, max, opts.todayISO ?? todayISO());
  const rangeStartISO = range.startISO;
  const dayCount = timelineDayCount(
    rangeStartISO,
    range.endISO,
    ZOOM_DAY_COUNT[opts.zoom],
  );

  // Bucket once: zoom / expand / collapse re-derive this on every toggle.
  const byGroup = new Map<string, TimelineItem[]>();
  for (const it of local) {
    const k = `${it.board_id}:${it.group_id}`;
    const list = byGroup.get(k);
    if (list) list.push(it);
    else byGroup.set(k, [it]);
  }

  // Rollup rows are one per board × group. Key them the way items are keyed
  // (board id + group id); a board band sums every row passed for its board.
  const groupCounts = new Map<string, Counts>();
  const boardCounts = new Map<string, Counts>();
  for (const r of opts.rollup ?? []) {
    if (r.groupId !== null)
      groupCounts.set(`${r.boardId}:${r.groupId}`, {
        total: r.total,
        done: r.done,
        overdue: r.overdue,
      });
    const b = boardCounts.get(r.boardId) ?? { total: 0, done: 0, overdue: 0 };
    boardCounts.set(r.boardId, {
      total: b.total + r.total,
      done: b.done + r.done,
      overdue: b.overdue + r.overdue,
    });
  }

  const stageFilter = opts.stageKey === ALL_ITEMS_KEY ? null : opts.stageKey;
  const rows: GanttRow[] = [];
  let totalBoards = 0;
  let totalItems = 0;
  const boardOfItem = new Map<string, string>();
  const noDateBoards = new Set<string>();
  // Every row on the chart under the current filters, open or not.
  const chartedRows: GanttRow[] = [];
  for (const boardId of data.board_order) {
    if (opts.boardId && boardId !== opts.boardId) continue;
    const board = boards.get(boardId);
    if (!board) continue;
    // Stage keys are group names. The synthetic ALL_ITEMS_KEY ("__all__") is
    // the folder's one stage when nothing is grouped — i.e. "everything",
    // the same as no stage filter.
    const groups = board.groups
      .filter((g) => stageFilter === null || stageKey(g.name) === stageFilter)
      .sort((a, b) => a.position - b.position);
    if (groups.length === 0) continue;
    const boardBand: GanttRow = {
      itemId: `board:${boardId}`,
      name: board.name,
      scheduled: false,
      kind: "section",
      level: 0,
    };
    rows.push(boardBand);
    totalBoards++;
    // A closed board is still laid out (for the totals, its summary and its
    // "no dates" note); its group bands just aren't emitted.
    const boardOpen = opts.expandedBoards.has(boardId);
    const schedule = boardScheduleOf(board);
    if (!schedule.startSourceId) {
      noDateBoards.add(boardId);
      continue;
    }
    const synthetic = [schedule.startSourceId, schedule.endSourceId].filter(
      (id): id is string => isSyntheticDateSource(id),
    );
    const boardRows: GanttRow[] = [];
    for (const g of groups) {
      const groupItems = byGroup.get(`${boardId}:${g.id}`) ?? [];
      if (groupItems.length === 0) continue;
      // buildGanttRows reads id / name / parent_id / position (+ the
      // timestamps for synthetic sources) — all present on a TimelineItem.
      const cacheItems = groupItems as unknown as CacheItem[];
      const cells = [
        ...contextCellValues(groupItems),
        ...(synthetic.length
          ? syntheticDateCellValues(cacheItems, synthetic)
          : []),
      ];
      const built = buildGanttRows(
        cacheItems,
        cells,
        schedule.startSourceId,
        schedule.endSourceId,
        rangeStartISO,
        dayCount,
        opts.zoom,
      ).rows;
      // Same rule as the board Gantt: dated items, plus undated parents that
      // carry a dated sub-item. Undated leaves stay off the folder chart.
      const onTimeline = built.filter((r) => r.scheduled || r.hasChildren);
      if (onTimeline.length === 0) continue;
      totalItems += onTimeline.length;
      boardRows.push(...onTimeline);
      if (!boardOpen) continue;
      const groupBand: GanttRow = {
        itemId: `group:${g.id}`,
        name: g.name,
        scheduled: false,
        kind: "section",
        level: 1,
      };
      const groupSpan = spanOfRows(onTimeline);
      if (groupSpan)
        groupBand.summary = {
          ...groupSpan,
          ...progressOf(groupCounts.get(`${boardId}:${g.id}`)),
        };
      rows.push(groupBand);
      if (!opts.expandedGroups.has(g.id)) continue;
      for (const r of visibleRows(onTimeline, opts.expanded)) {
        rows.push(r);
        boardOfItem.set(r.itemId, boardId);
      }
    }
    if (boardRows.length === 0) {
      noDateBoards.add(boardId);
      continue;
    }
    chartedRows.push(...boardRows);
    const boardSpan = spanOfRows(boardRows);
    if (boardSpan)
      boardBand.summary = {
        ...boardSpan,
        ...progressOf(boardCounts.get(boardId)),
      };
  }

  const inView = new Set(boardOfItem.keys());
  const dependencies = data.dependencies.filter(
    (d) => inView.has(d.predecessor_id) && inView.has(d.successor_id),
  );
  const itemRows = rows.filter((r) => r.kind !== "section");
  const violations = detectViolations(itemRows, dependencies);
  const externalItems: TimelineItem[] = data.items.filter(
    (i) => !inView.has(i.id),
  );
  const externalLinks = crossBoardStubs({
    dependencies: data.dependencies,
    localItemIds: inView,
    localSpans: spans,
    context: { boards: data.boards, items: externalItems },
    contextSpans: spans,
  });

  // Late links over everything charted, NOT just what is in view: with every
  // board closed there are no item rows, and the header must still say how
  // many links are late. Same two rules as above (detectViolations for links
  // inside the chart, a late stub for links leaving it), keyed by link id.
  const charted = new Set(chartedRows.map((r) => r.itemId));
  const lateLinks = detectViolations(
    chartedRows,
    data.dependencies.filter(
      (d) => charted.has(d.predecessor_id) && charted.has(d.successor_id),
    ),
  );
  const offChart = crossBoardStubs({
    dependencies: data.dependencies,
    localItemIds: charted,
    localSpans: spans,
    context: {
      boards: data.boards,
      items: data.items.filter((i) => !charted.has(i.id)),
    },
    contextSpans: spans,
  });
  for (const stubs of offChart.values())
    for (const s of stubs) if (s.late) lateLinks.add(s.dependencyId);

  return {
    rows,
    dependencies,
    externalLinks,
    violations,
    rangeStartISO,
    dayCount,
    boardOfItem,
    noDateBoards,
    totals: {
      boards: totalBoards,
      items: totalItems,
      lateLinks: lateLinks.size,
    },
  };
}
