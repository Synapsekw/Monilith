"use client";

import { useCallback, useState } from "react";
import { MAX_ASK_HISTORY } from "@/lib/ai/board-intelligence/ask-input";
import type { IntelAskEvent } from "@/lib/ai/board-intelligence/ask-protocol";
import { readAskStream } from "@/components/ai/ask/use-ask-stream";

export type QaPair = { id: string; question: string; answer: string };

/** Spec §3.2: at most five pairs, component state, nothing persisted. */
const MAX_PAIRS = 5;

/**
 * One Q&A turn about the board brief on screen, grounded in a run.
 *
 * Talks to `POST /api/board-intelligence/ask` directly — NOT `useAskStream`,
 * which hardcodes `/api/ask` and a `{ conversationId }` body for a different
 * (persisted) protocol. This turn persists nothing: a reload clears every
 * pair, there is no `ai_conversations`/`ai_messages` row, and the route's own
 * `done` carries no ids to remember.
 *
 * History sent to the server is capped client-side to `MAX_ASK_HISTORY` for
 * request-size hygiene only — the route's own schema re-slices and truncates
 * regardless (it never rejects), so this is not validation duplicated from the
 * server, just not sending more than the server will ever use.
 */
export function useIntelligenceAsk(runId: string | null) {
  const [pairs, setPairs] = useState<QaPair[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      // No run means no grounding, which is the whole contract of this surface
      // — and the one place LLM spend on this tab starts.
      if (!runId || !q || streaming) return;
      setError(null);
      setStreaming(true);
      const id = crypto.randomUUID();
      setPairs((prev) =>
        [...prev, { id, question: q, answer: "" }].slice(-MAX_PAIRS),
      );
      try {
        const res = await fetch("/api/board-intelligence/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId,
            question: q,
            history: pairs
              .filter((p) => p.answer)
              .slice(-MAX_ASK_HISTORY)
              .map(({ question, answer }) => ({ question, answer })),
          }),
        });
        if (!res.ok || !res.body) {
          const message = await res
            .json()
            .then((b: { error?: string }) => b.error)
            .catch(() => undefined);
          setError(message ?? "Request failed.");
          return;
        }
        await readAskStream<IntelAskEvent>(res, (e) => {
          if (e.type === "token")
            setPairs((prev) =>
              prev.map((p) =>
                p.id === id ? { ...p, answer: p.answer + e.text } : p,
              ),
            );
          else if (e.type === "status") setStatus(e.text);
          else if (e.type === "error") setError(e.message);
        });
      } catch {
        // Nothing is persisted on this surface, so a severed body has no
        // answer to recover — say so rather than leaving a blank pair.
        setError("The answer didn't finish. Try again.");
      } finally {
        setStreaming(false);
        setStatus(null);
      }
    },
    [pairs, runId, streaming],
  );

  return { pairs, streaming, status, error, ask };
}
