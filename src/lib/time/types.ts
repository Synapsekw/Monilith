import type { Tables } from "@/types/database.types";

export type TimeAllocationRow = Tables<"time_allocations">;

export type TimeCardRowKind = "item" | "category";

/** A timer-tracked second total per (item, day) merged into the card as a
 * read-only sub-label ("incl. 1.5h tracked"); editing a cell only writes the
 * manual portion. */
export interface TimerSecsByItemDay {
  itemId: string;
  day: string; // ISO date
  secs: number;
}

/** One day-cell on the weekly card. `manualSecs` is editable; `timerSecs` is
 * read-only (from time_entries) and shown as a sub-label. */
export interface TimeCardCell {
  day: string; // ISO date (Mon..Sun)
  manualSecs: number;
  timerSecs: number;
}

/** One card row: either a board item or a free-text category. */
export interface TimeCardRow {
  key: string; // stable: `item:<id>` or `cat:<category>`
  kind: TimeCardRowKind;
  itemId: string | null;
  boardId: string | null;
  boardName: string | null;
  category: string | null;
  label: string; // item name or category text
  cells: TimeCardCell[]; // one per day in the week, in order
  totalSecs: number;
}

/** Full payload for a rendered week. The card is daily; the server owns the
 * clock + week bounds so SSR/CSR agree (mirrors workload's `today` pattern). */
export interface TimeCardData {
  weekStart: string; // ISO date of Monday
  days: string[]; // 7 ISO dates Mon..Sun
  rows: TimeCardRow[];
  userId: string;
}
