import type { StatusColor } from "@/components/ui/status-pill";

/**
 * How a `user_agent_runs` row should READ to its owner.
 *
 * Client-safe on purpose (no `server-only`, unlike `agents-db.ts`): the roster
 * and the run-history disclosure are client components, and the run endpoint
 * imports `CLAIM_PLACEHOLDER` from here too, so the sentinel has exactly one
 * definition.
 *
 * The subtlety this module exists for: the stored `status` is NOT the display
 * status. `/api/ai/personal-agent` claims its fire slot by INSERTING the run
 * row before any token spend or email, and the `status` check constraint offers
 * only ('ran','skipped','error') — no 'pending' — so a freshly claimed,
 * perfectly healthy run sits in the table as `status = 'error'` until it
 * finalises. Rendering that verbatim would show "Failed" for every run in
 * flight, which is exactly the kind of false alarm that trains an owner to
 * ignore the column. Adding a fourth status value would be the cleaner fix, but
 * it is a constraint migration plus a change to every writer; the sentinel is
 * already load-bearing in the route, so this reads it rather than duplicating
 * the state machine.
 */

/**
 * The placeholder `error` text the route writes on the claim insert. Kept
 * byte-identical to what `claimRun` stores — the two are compared with `===`,
 * so this constant is the contract, not a description of it.
 */
export const CLAIM_PLACEHOLDER = "claimed; result not yet recorded";

/**
 * How long a claimed-but-unfinalised run is given before it stops reading as
 * "in progress" and starts reading as "never finished". A real run is one
 * Anthropic call plus one Resend send — seconds, bounded well under the
 * platform's function timeout. Fifteen minutes is therefore far past any honest
 * in-flight run, and a row still sitting on the placeholder by then means the
 * process died between the claim and `finalizeRun`: the slot is consumed, no
 * retry will ever land on it, and no email is coming. That is a real failure
 * and the owner should see it — just not the same one as "the model errored".
 */
export const STALE_CLAIM_MS = 15 * 60 * 1000;

export type AgentRunDisplayStatus =
  | "ran"
  | "skipped"
  | "running"
  | "incomplete"
  | "error";

/** The subset of a run row any display decision needs. */
export type AgentRunLike = {
  status: string;
  error: string | null;
  createdAt: string;
};

/** One row of the expanded run history. Structurally an {@link AgentRunLike}. */
export type AgentRunSummary = AgentRunLike & {
  id: string;
  fireDate: string;
  fireHour: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

const PRESENTATION: Record<
  AgentRunDisplayStatus,
  { label: string; color: StatusColor }
> = {
  // Keystone status semantics (pulse-ui): success=green, neutral=gray,
  // in-progress=blue, needs-attention=yellow, failed=red.
  ran: { label: "Ran", color: "green" },
  skipped: { label: "Skipped", color: "gray" },
  running: { label: "In progress", color: "blue" },
  incomplete: { label: "Didn't finish", color: "yellow" },
  error: { label: "Failed", color: "red" },
};

/**
 * Map a stored run row to the status the owner should actually see.
 * `nowMs` is injectable so tests don't depend on the clock.
 */
export function agentRunDisplayStatus(
  run: AgentRunLike,
  nowMs: number = Date.now(),
): AgentRunDisplayStatus {
  if (run.status === "ran") return "ran";
  if (run.status === "skipped") return "skipped";

  // Everything below is stored 'error'. Only the claim placeholder is
  // ambiguous; any other error text is a genuine, already-finalised failure.
  if (run.error !== CLAIM_PLACEHOLDER) return "error";

  const startedMs = new Date(run.createdAt).getTime();
  // An unparseable timestamp must not silently become "in progress" forever —
  // NaN comparisons are false, so state the fallback explicitly instead of
  // leaning on that.
  if (Number.isNaN(startedMs)) return "incomplete";
  return nowMs - startedMs < STALE_CLAIM_MS ? "running" : "incomplete";
}

export function agentRunStatusLabel(status: AgentRunDisplayStatus): string {
  return PRESENTATION[status].label;
}

export function agentRunStatusColor(
  status: AgentRunDisplayStatus,
): StatusColor {
  return PRESENTATION[status].color;
}

/** Longest failure/skip reason rendered inline before an ellipsis. */
const REASON_MAX = 160;

/**
 * A one-line account of what a run did, in the owner's terms — the "failure
 * reason" half of the spec's run-history requirement.
 *
 * `skipped` and `error` rows carry their reason in `error`, and it is written
 * for this audience: the route stores things like "Personal agents currently
 * require an Anthropic key…". It is the owner's own agent's diagnostic text and
 * they are the only one who can read the row (RLS), so it is shown rather than
 * flattened to a generic message — that flattening is precisely what made every
 * gotcha-70 failure mode invisible. Truncated so one pathological message can't
 * blow out the row.
 */
export function describeAgentRun(
  run: AgentRunLike,
  nowMs: number = Date.now(),
): string {
  const status = agentRunDisplayStatus(run, nowMs);
  if (status === "ran") return "Briefing sent";
  if (status === "running") return "Claimed its slot — still running";
  if (status === "incomplete") {
    return "Claimed its slot but never finished — no briefing was sent";
  }
  const reason = run.error?.trim();
  if (!reason) {
    return status === "skipped" ? "Skipped" : "Failed, with no reason recorded";
  }
  return reason.length > REASON_MAX
    ? `${reason.slice(0, REASON_MAX).trimEnd()}…`
    : reason;
}
