import type { SignalKind, SignalTone } from "./types";

/** A group is stalled when nothing in it changed for this many days (spec §3.1). */
export const STALL_DAYS = 5;
/** A person is overloaded when their open load exceeds the board median × this. */
export const OVERLOAD_RATIO = 1.25;
/** Chips the strip shows; signals beyond this stay available to the Phase-2 run. */
export const MAX_CHIPS = 5;

/** Strip order (spec §3.2): overdue, blocked, overloaded, stalled, changed. */
export const SIGNAL_ORDER: readonly SignalKind[] = [
  "overdue",
  "blocked",
  "overloaded",
  "stalled",
  "changed",
] as const;

/** Tone per kind — status colours are the only sanctioned multi-colour set (pulse-ui). */
export const SIGNAL_TONE: Record<SignalKind, SignalTone> = {
  overdue: "red",
  blocked: "orange",
  overloaded: "yellow",
  stalled: "gray",
  changed: "accent",
};

/**
 * Status option labels that read as "blocked" — the same label-regex idiom
 * `src/lib/boards/overdue.ts` uses for done (/done|complete/i). The default
 * status column ships a "Stuck" option (`src/lib/boards/column-defaults.ts`).
 * Word-bounded: a bare substring match made "Unstuck" — the opposite state —
 * count as blocked.
 */
export const BLOCKED_LABEL = /\b(stuck|blocked)\b/i;

/** Numbers columns that weight a person's load, by name. Absent → weight 1 per item. */
export const EFFORT_COLUMN_NAME = /effort|estimate|points|hours/i;
