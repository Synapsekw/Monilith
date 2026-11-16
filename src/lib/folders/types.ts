import type { ResolvedLayout } from "./layout";
import type { FolderAccessHead } from "./sharing-types";

/**
 * Shared, pure data contract for the folder command center. No DB, no React.
 * Every later task (server actions, RSC pages, client widgets) imports these
 * names exactly as declared here — do not rename or reshape.
 */

/**
 * Every folder RPC guard (`_assert_folder_member`) raises ONE code, P0002,
 * for both a nonexistent folder and a real folder in another org — a 0-row
 * `.maybeSingle()` miss on a direct table write maps to the same message.
 */
export const FOLDER_GONE_ERROR = "That folder no longer exists.";

/**
 * Generic fallback for a folder RPC failure that is NOT the P0002 not-found
 * case (a transport error, an unexpected Postgres error, or a row that failed
 * Zod validation). Raw `error.message` / Zod issue text is never forwarded to
 * the UI — it's logged server-side instead — so this is what callers show.
 */
export const FOLDER_DATA_ERROR = "Couldn't load folder data. Please try again.";

export type FolderSummary = {
  id: string;
  name: string;
  workspaceId: string;
  orgId: string;
  position: number;
};

export type FolderBoardRef = { id: string; name: string; position: number };

export type FolderPlacement = {
  boardId: string;
  folderId: string;
  position: number;
};

export type FolderNavData = {
  folders: FolderSummary[];
  placements: FolderPlacement[];
};

export type RollupRow = {
  boardId: string;
  boardName: string;
  boardPosition: number;
  groupId: string | null;
  groupName: string | null;
  groupColor: string | null;
  groupPosition: number | null;
  total: number;
  done: number;
  inProgress: number;
  overdue: number;
  notStarted: number;
  blocked: number;
  stale: number;
  unassigned: number;
  incomplete: number;
  plannedByToday: number;
  dueThisWeek: number;
  dueThisWeekNotStarted: number;
  oldestOverdue: string | null;
  minDue: string | null;
  maxDue: string | null;
  /** Done items that have a due date: the done side of "Gap to plan". */
  doneDated: number;
};

export type BurnRow = {
  stageKey: string;
  weekStart: string;
  planned: number;
  completed: number;
  /** Completions that happened on the item's creation day (arrived done). */
  importedDone?: number;
  /** Items overdue as of the end of that week; 0 for future weeks. */
  overdueOpen?: number;
};

/** Open items by board, stage and the week they are planned for. Weeks older
 *  than the window are folded into its first week by the RPC. */
export type LoadRow = {
  boardId: string;
  stageKey: string;
  weekStart: string;
  openDue: number;
};

/**
 * `folder_burn_packed`'s single jsonb value, validated on the server and sent
 * to the browser AS IS (only the non-zero cells, a few KB) instead of the
 * dense `BurnRow[]` (about 500 KB for a 59-stage × 73-week folder). The client
 * expands it once with `burnRowsOf` (src/lib/folders/packed.ts).
 * Each row: [stage_index, week_offset, planned, completed, imported_done,
 * overdue_open]; week_offset is whole weeks after `lo`.
 */
export type BurnPacked = {
  lo: string | null;
  hi: string | null;
  stages: string[];
  rows: [number, number, number, number, number, number][];
};

/**
 * The load heat map's read, tri-state: `skipped` (the layout has no load
 * section, or the folder has no dated items), `failed` (the read failed: the
 * panel offers Retry), or `ready` with the server's week columns and rows.
 */
export type FolderLoad =
  | { status: "skipped" }
  | { status: "failed" }
  | { status: "ready"; weeks: string[]; rows: LoadRow[] };

export type AttentionReason = "overdue" | "blocked" | "unassigned" | "stale";

export type AttentionRow = {
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  groupId: string | null;
  groupName: string | null;
  reason: AttentionReason;
  ageDays: number;
  severity: number;
};

/**
 * The item lists `folder_kpi_items` can return: `total` plus every count
 * column of `folder_rollup`, under the column's own name. The SQL predicate
 * for each is folder_rollup's filter for that column, so a list's total
 * equals the number the page shows for the same board and stage.
 */
export const KPI_ITEM_KINDS = [
  "total",
  "done",
  "in_progress",
  "overdue",
  "not_started",
  "blocked",
  "stale",
  "unassigned",
  "incomplete",
  "planned_by_today",
  "due_this_week",
  "due_this_week_not_started",
  "done_dated",
] as const;
export type KpiItemKind = (typeof KPI_ITEM_KINDS)[number];

/** One item behind a KPI number. */
export type KpiItemRow = {
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  groupId: string | null;
  groupName: string | null;
  dueOn: string | null;
  doneOn: string | null;
  lastTouched: string | null;
  isDone: boolean;
  isOverdue: boolean;
};

/** One bounded page of a KPI's items, with the count of ALL matching items. */
export type KpiItemsPage = { rows: KpiItemRow[]; total: number };

/**
 * One bounded page of attention rows. `total` is the count of ALL matching
 * rows; null when it cannot be known (a database without
 * `folder_attention_page`, where the old read stopped at its 100-row limit).
 */
export type AttentionPage = { rows: AttentionRow[]; total: number | null };

/** Shown when the item list's function is not in the database yet. */
export const KPI_ITEMS_UNAVAILABLE =
  "This list is not available yet. Try again later.";

export type WorkloadRow = {
  userId: string | null;
  boardId: string;
  boardName: string;
  stageKey: string;
  stageName: string;
  open: number;
  overdue: number;
};

export type GalleryRow = {
  folderId: string;
  name: string;
  position: number;
  boards: number;
  items: number;
  done: number;
  overdue: number;
  attention: number;
};

export type IntelligenceBrief = {
  boardId: string;
  boardName: string;
  brief: string;
  generatedAt: string;
};

export type FolderMember = {
  userId: string;
  fullName: string | null;
  /** From the org roster the viewer can already read; the display fallback. */
  email?: string | null;
  avatarUrl: string | null;
};

export type FolderPayload = {
  folder: FolderSummary;
  boards: FolderBoardRef[];
  rollup: RollupRow[] | null;
  /** The packed burn value; null when not requested or the read failed. The
   *  client expands it to `BurnRow[]` once (CommandCenter). */
  burnPacked: BurnPacked | null;
  /** Board × week load grid: skipped, failed, or the server's weeks + rows. */
  load: FolderLoad;
  attention: AttentionRow[] | null;
  /** Count of ALL attention rows in the folder. `attention` holds the first
   *  ATTENTION_LIMIT of them; when this is larger (or null: unknown), the
   *  page reads each board's rows on demand instead of filtering the sample.
   *  Undefined (older payloads, fixtures) means the sample is complete. */
  attentionTotal?: number | null;
  /** True when the rollup read was cut by a row cap: the numbers on the page
   *  are then incomplete and the page says so. */
  rollupCapped?: boolean;
  briefs: IntelligenceBrief[];
  members: FolderMember[];
  /** Who the folder is shared with (avatar stack) and whether the caller may manage it. */
  access: FolderAccessHead;
  /** Resolved per-folder command center layout. Absent row = project preset. */
  layout: ResolvedLayout;
  generatedAt: string;
  todayISO: string;
};
