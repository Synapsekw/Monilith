"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { summarizeThread } from "@/lib/ai/summarize/actions";
import { Button } from "@/components/ui/button";

/**
 * "Catch me up": a read-only, opt-in summary of an item's updates thread.
 * Local state only — the server action fires ONLY on the explicit button
 * click (spec perf budget, gotcha-09), never on mount or on thread changes.
 * Each click replaces the previous summary/error, mirroring AskPulse's
 * single-shot ask→answer pattern.
 */
export function ThreadSummary({
  itemId,
  disabled = false,
}: {
  itemId: string;
  disabled?: boolean;
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isDisabled = disabled || itemId.length === 0 || isPending;

  function catchMeUp() {
    if (isDisabled) return;
    setSummary(null);
    setError(null);
    startTransition(async () => {
      const res = await summarizeThread({ itemId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSummary(res.data.summary);
    });
  }

  function dismiss() {
    setSummary(null);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={catchMeUp}
          disabled={isDisabled}
          className="gap-1.5"
        >
          <Sparkles className="text-brand size-3.5" />
          {isPending ? "Thinking…" : "Catch me up"}
        </Button>
        <p className="text-muted-foreground text-xs">
          Summarizes this thread with AI.
        </p>
      </div>

      <div aria-live="polite">
        {isPending ? (
          <div className="bg-surface-muted border-border rounded-lg border p-3.5 text-sm">
            <p className="text-muted-foreground">Reading the thread…</p>
          </div>
        ) : null}

        {summary && !isPending ? (
          <div className="bg-surface-muted border-border animate-fadein rounded-lg border p-3.5 text-sm">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-kicker text-3xs font-mono tracking-wide uppercase">
                Thread summary
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
                Dismiss
              </Button>
            </div>
            <p className="whitespace-pre-wrap">{summary}</p>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
