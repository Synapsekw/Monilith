"use client";

import { useRef, useState } from "react";
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
  /** Only the newest pair can be the one in flight — `ask` refuses while a
   *  turn is streaming, so an earlier empty pair is a turn that ENDED. */
  const inFlightId = pairs.at(-1)?.id;
  /**
   * Which pair is being promoted into a thread, if any.
   *
   * COMPONENT state, deliberately — not the store's `busy[boardId]` claim that
   * guards apply/dismiss. That one is board-scoped and lives in the store
   * because a board WRITE must stay serialised even after this panel unmounts,
   * and because two writes race the same jsonb array. Promotion is neither:
   * it inserts its own `ai_conversations`/`ai_messages` rows and touches no
   * run, and the only way to duplicate one is a second click on THIS button,
   * which cannot outlive the component that renders it. Borrowing `busy` would
   * also grey out every suggestion card's Apply while a thread opens, saying
   * something false about the board.
   *
   * The ref is the half that holds when the click beats the render: two clicks
   * in one tick both read the pre-render state, so `promoting.current` — not
   * `promotingId` — is what makes the second one a no-op.
   */
  const promoting = useRef(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);

  async function submit() {
    const q = draft.trim();
    if (!q || disabled) return;
    setDraft("");
    await ask(q);
  }

  async function openInChat(pair: QaPair) {
    if (!onOpenInChat || promoting.current) return;
    promoting.current = true;
    setPromotingId(pair.id);
    try {
      await onOpenInChat(pair);
    } finally {
      // On success the parent switches to Chat and unmounts this panel, so
      // these are no-ops. On failure it stays mounted and renders its own
      // error — and the reader needs the action back to retry.
      promoting.current = false;
      setPromotingId(null);
    }
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
              {/* Three states, never conflated: the answer; the turn still
                  running; and a turn that ENDED with nothing. Only one turn
                  can be in flight (`ask` refuses while `streaming`), so
                  `streaming` is what separates the last two — without it an
                  empty pair reads "Thinking…" forever. The bubble says what
                  happened to THIS pair; the alert below says what to do. */}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {pair.answer || (
                  <span className="text-muted-foreground">
                    {streaming && pair.id === inFlightId
                      ? (status ?? "Thinking…")
                      : "No answer came back."}
                  </span>
                )}
              </p>
              {pair.answer && onOpenInChat && (
                <div>
                  <Button
                    size="xs"
                    variant="link"
                    disabled={promotingId !== null}
                    onClick={() => void openInChat(pair)}
                  >
                    {promotingId === pair.id ? "Opening…" : "Open in Chat"}
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
