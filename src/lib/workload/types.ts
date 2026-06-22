import type { Tables } from "@/types/database.types";

export type MemberCapacityRow = Tables<"member_capacity">;

/** App fallbacks when an org has no org_workload_settings row. */
export const EFFORT_FALLBACK = {
  hoursPerDay: 8,
  perItemHours: 4,
  workingDays: [1, 2, 3, 4, 5] as number[], // ISO weekday: 1=Mon … 7=Sun
} as const;

export interface OrgWorkloadDefaults {
  hoursPerDay: number;
  perItemHours: number;
  workingDays: number[];
}

export interface MemberCapacity {
  userId: string;
  hoursPerDay: number;
  workingDays: number[];
  customized: boolean; // false ⇒ derived from org defaults
}

export interface WorkloadMember {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/** One raw row from workload_rollup(): one per (item, assignee). */
export interface WorkloadRawRow {
  itemId: string;
  boardId: string;
  itemName: string;
  userId: string | null; // null ⇒ unassigned
  startDate: string; // ISO
  endDate: string; // ISO
  estimateSecs: number | null;
}

export type CapacityState = "under" | "at" | "over" | "none";

export interface WeekBucket {
  weekKey: string; // ISO date of the bucket's start day
  label: string; // e.g. "Jun 1"
  workingDays: number; // count of working days in this bucket (org-default mask; informational)
}

export interface BucketCell {
  weekKey: string;
  effortSecs: number;
  capacitySecs: number;
  ratio: number | null; // effort/capacity; null when capacity is 0
  state: CapacityState;
}

export interface MemberRow {
  userId: string | null; // null ⇒ the synthetic "Unassigned" row
  member: WorkloadMember | null;
  cells: BucketCell[];
  totalEffortSecs: number;
  totalCapacitySecs: number;
}

export interface WorkloadGrid {
  window: WeekBucket[]; // canonical column order (per-member capacity computed separately)
  rows: MemberRow[];
}
