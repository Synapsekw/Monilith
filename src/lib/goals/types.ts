import type { Tables } from "@/types/database.types";

export type GoalProgressMode = Tables<"goals">["progress_mode"];
export type GoalStatus = Tables<"goals">["status"];
export type GoalHealth = "on_track" | "at_risk" | "off_track";

export interface RowOwner {
  id: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/** A flat goal as loaded from the DB, camelCased for the client. */
export interface GoalRow {
  id: string;
  parentGoalId: string | null;
  name: string;
  description: string | null;
  ownerId: string;
  workspaceId: string | null;
  progressMode: GoalProgressMode;
  status: GoalStatus;
  startValue: number | null;
  currentValue: number | null;
  targetValue: number | null;
  unit: string | null;
  percent: number | null;
  startDate: string | null;
  dueDate: string | null;
  position: number;
}

/** Raw per-board aggregate row from goals_rollup(). */
export interface BoardAgg {
  goalId: string;
  boardId: string;
  total: number;
  done: number;
}

/** An assembled tree node with derived progress (0..1) + auto-health. */
export interface GoalNode extends GoalRow {
  children: GoalNode[];
  progress: number | null;
  autoHealth: GoalHealth | null;
  owner: RowOwner | null;
}
