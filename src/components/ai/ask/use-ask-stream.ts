"use client";
import { useCallback, useState } from "react";
import type { AskStreamEvent } from "@/lib/ai/ask/stream-protocol";

/**
 * How a turn's response body ended.
 *
 * `"ok"`      — a terminal event was observed (`done`, or the route's own
 *               `error`, which already surfaces a message), or the request
 *               failed before the body and an `error` event was synthesized.
 * `"dropped"` — the body ended with NO terminal event, or the fetch/reader
 *               threw. The turn is very often still running server-side and its
 *               answer lands in `ai_messages` moments later, so the caller must
 *               attempt recovery rather than render nothing (gotcha-61).
 *
 * Deliberately NOT part of `AskStreamEvent`: a drop is a client-local
 * condition. Nothing could ever emit it over the wire — the wire is gone.
 */
export type StreamOutcome = "ok" | "dropped";

/**
 * Read an NDJSON response body, dispatching each parsed event in order.
 *
 * Returns whether a **terminal** event (`done` or `error`) was seen. A reader
 * loop that ends without one means the response was severed mid-turn.
 */
export async function readAskStream(
  res: Response,
  onEvent: (e: AskStreamEvent) => void,
): Promise<boolean> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let terminated = false;
  const dispatch = (e: AskStreamEvent) => {
    if (e.type === "done" || e.type === "error") terminated = true;
    onEvent(e);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      // Complete lines are strict: truncation can only ever happen at the tail.
      if (line) dispatch(JSON.parse(line) as AskStreamEvent);
    }
  }
  // Flush a trailing line with no terminating newline. A severed body usually
  // cuts mid-line, so a parse failure here IS the drop signature — not a
  // protocol error worth throwing over.
  const tail = buf.trim();
  if (tail) {
    try {
      dispatch(JSON.parse(tail) as AskStreamEvent);
    } catch {
      /* truncated tail — leaves `terminated` false, which is the truth */
    }
  }
  return terminated;
}

/** POST to /api/ask for a conversation and stream its NDJSON events. `streaming`
 *  drives the composer's disabled state; the resolved `StreamOutcome` tells the
 *  caller whether the turn ended normally or the stream was severed. */
export function useAskStream() {
  const [streaming, setStreaming] = useState(false);
  const send = useCallback(
    async (
      conversationId: string,
      onEvent: (e: AskStreamEvent) => void,
    ): Promise<StreamOutcome> => {
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
          return "ok";
        }
        return (await readAskStream(res, onEvent)) ? "ok" : "dropped";
      } catch {
        // A throw mid-read is a severed stream, not a failed turn: the server
        // keeps going and usually persists the answer. Recovery, not an error.
        return "dropped";
      } finally {
        setStreaming(false);
      }
    },
    [],
  );
  return { streaming, send };
}
