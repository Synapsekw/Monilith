"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useBoardIntelligenceStore } from "@/stores/board-intelligence";
import { useIntelligenceAsk, type QaPair } from "./use-intelligence-ask";

/**
 * Ask a question about the brief on screen (spec §3.2).
 *
 * Disabled with no run: answers are grounded in the run by contract, and this
 * is the one place LLM spend starts on this tab. Also disabled while a board
 * write (apply/undo/dismiss) is in flight for this board — `busy[boardId]`
 * lives in the store rather than this component because it must survive the
 * tab unmounting (dock close, Chat switch). Nothing here is persisted — a
 * reload clears every pair.
 */
export function AskComposer({
  runId,
  boardId,
  onOpenInChat,
}: {
  runId: string | null;
  boardId: string;
  onOpenInChat?: (pair: QaPair) => void | Promise<void>;
}) {
  const { pairs, streaming, status, error, ask } = useIntelligenceAsk(runId);
  const busy = useBoardIntelligenceStore((s) => s.busy[boardId] ?? false);
  const [draft, setDraft] = useState("");
  const disabled = !runId || streaming || busy;

  async function submit() {
    const q = draft.trim();
    if (!q || disabled) return;
    setDraft("");
    await ask(q);
  }

  return (
    <div className="border-border flex flex-col gap-3 border-t pt-3">
      {pairs.length > 0 && (
        <ul className="flex flex-col gap-3">
          {pairs.map((pair) => (
            <li
              key={pair.id}
              className="bg-surface border-border flex flex-col gap-1 rounded-lg border p-2.5"
            >
              {/* Free-form user text (up to 500 chars, sentence-cased), so it
                  reads as a quiet LABEL — muted, smaller, medium weight —
                  never as a Kicker: that primitive's mono/uppercase/tracked
                  treatment is reserved for short, system-authored eyebrows
                  ("Last 7 days", "Suggested · 3"), not echoed user input. */}
              <p className="text-muted-foreground text-xs font-medium whitespace-pre-wrap">
                {pair.question}
              </p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {pair.answer || (
                  <span className="text-muted-foreground">
                    {status ?? "Thinking…"}
                  </span>
                )}
              </p>
              {pair.answer && onOpenInChat && (
                <div>
                  <Button
                    size="xs"
                    variant="link"
                    onClick={() => void onOpenInChat(pair)}
                  >
                    Open in Chat
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}

      <Textarea
        aria-label="Ask about this board"
        className="min-h-16"
        placeholder="Ask about this board…"
        value={draft}
        disabled={disabled}
        maxLength={500}
        onChange={(e) => setDraft(e.target.value)}
        // Enter sends, Shift+Enter is a newline — the dock composer's rule.
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {!runId && (
        <p className="text-muted-foreground text-3xs">
          Catch me up first — answers are grounded in the brief.
        </p>
      )}
    </div>
  );
}
