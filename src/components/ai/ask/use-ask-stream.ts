"use client";
import { useCallback, useState } from "react";
import type { AskStreamEvent } from "@/lib/ai/ask/stream-protocol";

/** Read an NDJSON response body, dispatching each parsed event in order. */
export async function readAskStream(
  res: Response,
  onEvent: (e: AskStreamEvent) => void,
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as AskStreamEvent);
    }
  }
  // Flush a trailing line with no terminating newline.
  const tail = buf.trim();
  if (tail) onEvent(JSON.parse(tail) as AskStreamEvent);
}

/** POST to /api/ask for a conversation and stream its NDJSON events. `streaming`
 *  drives the composer's disabled state. */
export function useAskStream() {
  const [streaming, setStreaming] = useState(false);
  const send = useCallback(
    async (conversationId: string, onEvent: (e: AskStreamEvent) => void) => {
      setStreaming(true);
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId }),
        });
        if (!res.ok || !res.body) {
          const error = await res
            .json()
            .then((b: { error?: string }) => b.error)
            .catch(() => undefined);
          onEvent({ type: "error", message: error ?? "Request failed." });
          return;
        }
        await readAskStream(res, onEvent);
      } catch {
        onEvent({ type: "error", message: "Ask Pulse lost its connection." });
      } finally {
        setStreaming(false);
      }
    },
    [],
  );
  return { streaming, send };
}
