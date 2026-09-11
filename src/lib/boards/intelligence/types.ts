/**
 * Board Intelligence — Phase 1 (Orient) types. A plain module (no server-only,
 * no "use server") so the signals engine, the client provider, the strip AND
 * the Phase-2 server run can all import it.
 */
export type SignalKind =
  "overdue" | "overloaded" | "stalled" | "changed" | "blocked";

export type SignalTone = "red" | "yellow" | "gray" | "accent" | "orange";

export type Signal = {
  kind: SignalKind;
  count: number;
  /** "overdue", "overloaded · Ana", "stalled groups", "changed since Tue", "blocked chain" */
  label: string;
  tone: SignalTone;
  /** Rows the chip filter shows. */
  itemIds: string[];
  /** stalled only: the groups to keep expanded. */
  groupIds?: string[];
  /** overloaded only: the person the chip is about. */
  subjectUserId?: string;
};

/** The active chip as mirrored to the URL: `intel=<kind>[:<subject>]`. */
export type IntelSelection = { kind: SignalKind; subject?: string };
