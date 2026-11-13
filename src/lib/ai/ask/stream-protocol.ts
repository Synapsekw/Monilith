// Client-safe (no server-only). NDJSON events over the /api/ask response body.
// Imported by both the server (route + engine) and the client stream hook, so it
// must never pull in server-only modules. `ValidatedAction` is safe to name
// here: `@/lib/ai/write/schema` is plain Zod and is already imported by the
// "use client" ActionConfirmCard.
//
// There is deliberately NO execution-result event. This body is ONE model turn,
// opened by POST /api/ask and closed when the turn ends; Approve happens after
// that stream is gone — possibly after a reload, in a different session. Nothing
// could ever emit such an event. Execution is a Server Action
// (`applyAskProposal`) returning `ActionResult`, which is also where AGENTS.md
// puts every mutation.
//
// Since the unified assistant runtime (2026-11) POST /api/ask no longer emits
// the `proposal` event: a turn that lines up changes emits `staged` instead,
// applied by `applyBatch`. The `proposal` type is kept so clients and tests
// that still handle it keep compiling, and so old proposal rows keep their
// shared vocabulary.
import type { ValidatedAction } from "@/lib/ai/write/schema";
import type { StagedCall } from "@/lib/assistant/staged";

/** Persisted + rendered when a proposal turn produced no lead-in text of its
 *  own. Shared so the engine, the DB row and the optimistic client bubble all
 *  say the same thing. */
export const PROPOSAL_FALLBACK_ANSWER = "Here's what I'll do — confirm below.";

/**
 * The FIRST event of every turn, emitted the moment the response body opens —
 * before compaction, before the first model round.
 *
 * The engine's own statuses only fire once a tool round has COMPLETED, so
 * without this the opening 25–42s of a turn carried no server signal at all
 * (gotcha-62). It is also the byte that proves to the client that the stream is
 * genuinely live rather than hung.
 */
export const OPENING_STATUS = "Reading your boards…";

export type AskStreamEvent =
  | { type: "token"; text: string }
  | { type: "status"; text: string }
  /** The turn ended at a confirm card. Emitted before persistence so the client
   *  can stash the actions; it binds them to the real message id at `done`. */
  | { type: "proposal"; actions: ValidatedAction[] }
  /** The turn lined up changes. Emitted before persistence; the client binds
   *  the calls to the real message id at `done`. */
  | { type: "staged"; calls: StagedCall[] }
  | {
      type: "done";
      conversationId: string;
      assistantMessageId: string;
      boardsConsulted: string[];
      title?: string;
    }
  | { type: "error"; message: string };

/** Serialize one event as an NDJSON line (JSON + newline delimiter). */
export function encodeEvent(e: AskStreamEvent): string {
  return JSON.stringify(e) + "\n";
}
