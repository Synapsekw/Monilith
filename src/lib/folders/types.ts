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
};

export type BurnRow = {
  stageKey: string;
  weekStart: string;
  planned: number;
  completed: number;
};

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
  avatarUrl: string | null;
};

export type FolderPayload = {
  folder: FolderSummary;
  boards: FolderBoardRef[];
  rollup: RollupRow[] | null;
  burn: BurnRow[] | null;
  attention: AttentionRow[] | null;
  briefs: IntelligenceBrief[];
  members: FolderMember[];
  generatedAt: string;
  todayISO: string;
};
