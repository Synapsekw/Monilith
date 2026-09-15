// Client-safe (no server-only): imported by the route AND the tab's hook.
//
// A separate union from `AskStreamEvent` on purpose. That protocol's `done`
// carries a conversationId and an assistantMessageId, and this turn persists
// NOTHING — there is no row to name (spec §3.2). Same NDJSON framing, two
// events fewer.
export type IntelAskEvent =
  | { type: "token"; text: string }
  | { type: "status"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** The first byte of every turn, before any model work — proof to the client
 *  that the stream is live rather than hung (the lesson of gotcha-62). */
export const INTEL_ASK_OPENING_STATUS = "Reading this board…";

export function encodeIntelEvent(e: IntelAskEvent): string {
  return JSON.stringify(e) + "\n";
}
