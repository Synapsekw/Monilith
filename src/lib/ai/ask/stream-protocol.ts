// Client-safe (no server-only). NDJSON events over the /api/ask response body.
// Imported by both the server (route + engine) and the client stream hook, so it
// must never pull in server-only modules.
export type AskStreamEvent =
  | { type: "token"; text: string }
  | { type: "status"; text: string }
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
