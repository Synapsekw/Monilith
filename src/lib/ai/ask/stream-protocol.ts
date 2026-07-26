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
import type { ValidatedAction } from "@/lib/ai/write/schema";

/** Persisted + rendered when a proposal turn produced no lead-in text of its
 *  own. Shared so the engine, the DB row and the optimistic client bubble all
 *  say the same thing. */
export const PROPOSAL_FALLBACK_ANSWER = "Here's what I'll do — confirm below.";

export type AskStreamEvent =
  | { type: "token"; text: string }
  | { type: "status"; text: string }
  /** The turn ended at a confirm card. Emitted before persistence so the client
   *  can stash the actions; it binds them to the real message id at `done`. */
  | { type: "proposal"; actions: ValidatedAction[] }
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
