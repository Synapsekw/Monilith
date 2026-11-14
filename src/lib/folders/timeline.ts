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
  /** Boards / items on the chart under the current filters — independent of
   * which boards or parents are collapsed, so the header doesn't jump. */
  totals: { boards: number; items: number };
};

/**
 * Lay a folder's boards out on one timeline: a band per board (folder order),
 * a band per group, then that group's scheduled items — each board read
 * through its own date sources. Links with both ends in view become arrows;
 * links to anything else (another folder, or filtered out by stage/board)
 * become stubs on the local bar. Pure, so every zoom / filter / collapse
 * toggle is a re-derive with no server round-trip.
 */
export function buildFolderTimeline(
  data: FolderTimelineData,
  opts: {
    stageKey: string | null;
    boardId: string | null;
    expanded: ReadonlySet<string>;
    zoom: TimelineZoom;
    collapsedBoards: ReadonlySet<string>;
  },
): FolderTimelineView {
  const boards = new Map(data.boards.map((b) => [b.id, b]));
  const external = new Set(data.external_item_ids);
  const local = data.items.filter((i) => !external.has(i.id));
  const spans = contextSpans({ boards: data.boards, items: data.items });

  // One shared axis for every board: earliest local start (or today) to the
  // latest local end, never narrower than the zoom window.
  let min: string | null = null;
  let max: string | null = null;
  for (const it of local) {
    const s = spans.get(it.id);
    if (!s) continue;
    if (min === null || s.start < min) min = s.start;
    if (max === null || s.end > max) max = s.end;
  }
  const rangeStartISO = min ?? todayISO();
  const dayCount = timelineDayCount(
    rangeStartISO,
    max ?? rangeStartISO,
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

  const stageFilter = opts.stageKey === ALL_ITEMS_KEY ? null : opts.stageKey;
  const rows: GanttRow[] = [];
  let totalBoards = 0;
  let totalItems = 0;
  const boardOfItem = new Map<string, string>();
  const noDateBoards = new Set<string>();
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
    rows.push({
      itemId: `board:${boardId}`,
      name: board.name,
      scheduled: false,
      kind: "section",
      level: 0,
    });
    totalBoards++;
    // A collapsed board is still laid out (for the totals and its "no dates"
    // note), its rows just aren't emitted.
    const collapsed = opts.collapsedBoards.has(boardId);
    const schedule = boardScheduleOf(board);
    if (!schedule.startSourceId) {
      noDateBoards.add(boardId);
      continue;
    }
    const synthetic = [schedule.startSourceId, schedule.endSourceId].filter(
      (id): id is string => isSyntheticDateSource(id),
    );
    let dated = false;
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
      dated = true;
      totalItems += onTimeline.length;
      if (collapsed) continue;
      rows.push({
        itemId: `group:${g.id}`,
        name: g.name,
        scheduled: false,
        kind: "section",
        level: 1,
      });
      for (const r of visibleRows(onTimeline, opts.expanded)) {
        rows.push(r);
        boardOfItem.set(r.itemId, boardId);
      }
    }
    if (!dated) noDateBoards.add(boardId);
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
  return {
    rows,
    dependencies,
    externalLinks,
    violations,
    rangeStartISO,
    dayCount,
    boardOfItem,
    noDateBoards,
    totals: { boards: totalBoards, items: totalItems },
  };
}
