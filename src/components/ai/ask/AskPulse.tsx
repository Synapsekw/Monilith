"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { askPulse } from "@/lib/ai/ask/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const MIN_QUESTION = 3;

type Answer = { text: string; boardsConsulted: number };

/**
 * Ask Pulse panel: a single stateless question about the caller's boards,
 * answered by the server action (org/workspace resolved server-side). Each ask
 * replaces the previous answer — no conversation history in v1.
 */
export function AskPulse({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canAsk = question.trim().length >= MIN_QUESTION && !isPending;

  function submit() {
    const q = question.trim();
    if (q.length < MIN_QUESTION || isPending) return;
    // Asking again clears the prior answer/error so the panel shows the
    // thinking state, not a stale result.
    setAnswer(null);
    setError(null);
    startTransition(async () => {
      const res = await askPulse({ question: q });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAnswer({
        text: res.data.answer,
        boardsConsulted: res.data.boardsConsulted.length,
      });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-brand size-4" />
            Ask Pulse
          </DialogTitle>
          <DialogDescription>
            Ask a question about your boards.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Textarea
            autoFocus
            rows={3}
            value={question}
            disabled={isPending}
            placeholder="What's overdue across my boards?"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            aria-label="Your question"
          />
          <div className="flex items-center justify-end gap-3">
            <span className="text-muted-foreground text-xs">⌘↵ to ask</span>
            <Button type="submit" size="sm" disabled={!canAsk}>
              {isPending ? "Asking…" : "Ask"}
            </Button>
          </div>
        </form>

        {isPending ? (
          <p aria-live="polite" className="text-muted-foreground py-2 text-sm">
            Looking across your boards…
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        {answer && !isPending ? (
          <div className="space-y-2">
            <p className="text-sm whitespace-pre-wrap">{answer.text}</p>
            <p className="text-muted-foreground text-xs">
              Consulted {answer.boardsConsulted}{" "}
              {answer.boardsConsulted === 1 ? "board" : "boards"}
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
