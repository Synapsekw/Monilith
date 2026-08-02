// Client-safe (NO server-only): imported by the /ask page, MessageList, the
// stream protocol's consumers, and the proposal Server Actions. Shapes the
// `ai_messages.tool_trace` jsonb column, which is untyped at the DB level — so
// everything read out of it goes through Zod before it is trusted.
import { z } from "zod";
import {
  validatedActionSchema,
  executionResultSchema,
} from "@/lib/ai/write/schema";

/** Hard cap on proposals stored (and later executed) for one turn. Mirrors the
 *  `.max(10)` in `executeActions` so the two surfaces cannot diverge. */
const MAX_PROPOSED_ACTIONS = 10;

/**
 * Two shapes share one column:
 *   proposal turn → { boardsConsulted, proposedActions }
 *   outcome turn  → { resolvesProposal, outcome, results }
 * Unknown keys are stripped rather than rejected, so today's
 * `{ boardsConsulted }` rows keep parsing and a future key never bricks a
 * thread's render.
 */
export const askToolTraceSchema = z.object({
  boardsConsulted: z.array(z.string()).optional(),
  proposedActions: z
    .array(validatedActionSchema)
    .max(MAX_PROPOSED_ACTIONS)
    .optional(),
  resolvesProposal: z.string().uuid().optional(),
  outcome: z.enum(["applied", "cancelled"]).optional(),
  results: z.array(executionResultSchema).optional(),
});
export type AskToolTrace = z.infer<typeof askToolTraceSchema>;

/** Parse one `tool_trace` value. Anything malformed degrades to `null` — a bad
 *  row must not take the whole conversation down with it. */
export function parseToolTrace(value: unknown): AskToolTrace | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const parsed = askToolTraceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Subset of ActionConfirmCard's ConfirmState that a persisted proposal can be
 *  in. "running" is transient client state, so it is not derivable from rows. */
export type ProposalState = "idle" | "done" | "error";
export type ProposalStatus = { state: ProposalState; note?: string };

/** Minimal shape this derivation needs — `UIMessage` satisfies it. */
export type TracedMessage = { id: string; trace?: AskToolTrace | null };

/**
 * Walk a thread once and decide, for each message carrying `proposedActions`,
 * whether it still awaits the user.
 *
 * A proposal is resolved by a LATER message whose trace names it in
 * `resolvesProposal` — never by mutating the proposal row, because
 * `ai_messages` has no UPDATE policy (RLS default-deny) and because the model's
 * context is built from `content` only, so the outcome has to be a real turn.
 * Deriving instead of storing also makes reload and live-update render
 * identically.
 */
export function resolveProposalStates(
  messages: TracedMessage[],
): Map<string, ProposalStatus> {
  const resolved = new Map<string, ProposalStatus>();
  for (const m of messages) {
    const t = m.trace;
    if (!t?.resolvesProposal) continue;
    if (t.outcome === "cancelled") {
      resolved.set(t.resolvesProposal, {
        state: "done",
        note: "Cancelled — nothing was changed.",
      });
      continue;
    }
    const errors = (t.results ?? []).flatMap((r) => (r.ok ? [] : [r.error]));
    resolved.set(
      t.resolvesProposal,
      errors.length
        ? { state: "error", note: errors.join("; ") }
        : { state: "done", note: "Applied." },
    );
  }

  const out = new Map<string, ProposalStatus>();
  for (const m of messages) {
    if (!m.trace?.proposedActions?.length) continue;
    out.set(m.id, resolved.get(m.id) ?? { state: "idle" });
  }
  return out;
}
