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

/* ── Phase 2 (Advise): the dock's Intelligence tab and the server run. ── */

/** A stored run older than this is treated as stale and re-run on open. */
export const INTELLIGENCE_STALE_MS = 30 * 60 * 1000;
/** Activity/updates window fed into the transcript the model sees. */
export const TRANSCRIPT_DAYS = 7;
/** Cap on activity-log rows pulled into the transcript. */
export const TRANSCRIPT_ACTIVITY_LIMIT = 150;
/** Cap on item-update rows pulled into the transcript. */
export const TRANSCRIPT_UPDATES_LIMIT = 50;
/** Rough token ceiling for the assembled transcript before it's sent. */
export const TRANSCRIPT_TOKEN_BUDGET = 6000;
/** Cap on board members/items indexed into the roster passed to the model. */
export const ROSTER_MAX_ITEMS = 120;
/** Cap on suggestions a single run may return (spec §4.4). */
export const MAX_SUGGESTIONS = 5;
/**
 * Cap on signal rows a stored run payload (and the prompt's SIGNALS block) may
 * carry. `computeSignals` emits ONE `overloaded` row per overloaded person, so
 * a busy board can produce far more than five — the payload schema caps the
 * array, and every producer slices to this BEFORE the schema sees it, or the
 * run fails validation after the model call was already metered.
 */
export const MAX_PAYLOAD_SIGNALS = 10;
/** Cap on status options listed per column in the prompt's COLUMNS block. */
export const MAX_PROMPT_COLUMN_OPTIONS = 50;

/** The single source of truth for the five signal kinds a `filter` action may
 *  target — was independently duplicated as a zod enum in `schema.ts` and a
 *  guard array in `validate.ts`; both now derive from this tuple. */
export const SIGNAL_KINDS = [
  "overdue",
  "overloaded",
  "stalled",
  "changed",
  "blocked",
] as const satisfies readonly SignalKind[];
