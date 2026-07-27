"use client";

import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MIN = 1;
const MAX = 4000;

/**
 * Chat composer: a growing textarea + submit. ⌘/Ctrl+Enter sends (mirrors the
 * retired AskPulse popup). Clears on a successful hand-off; stays disabled for
 * the whole of an in-flight turn.
 *
 * `disabled` is an affordance, not the guard — the real one-turn-at-a-time
 * check lives in AskChat, which owns the turn (gotcha-62).
 */
export function Composer({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const canSend = trimmed.length >= MIN && trimmed.length <= MAX && !disabled;

  function send() {
    if (!canSend) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <div className="bg-background border-t px-4 py-3">
      <form
        className="bg-surface focus-within:border-border-bright mx-auto flex max-w-3xl items-end gap-2 rounded-lg border p-2 transition-colors"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Textarea
          autoFocus
          rows={1}
          value={value}
          disabled={disabled}
          placeholder="Ask about your boards…"
          aria-label="Your question"
          className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-1.5 py-1.5 shadow-none focus-visible:border-0 focus-visible:ring-0"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!canSend}
          aria-label="Send"
          className="size-8 shrink-0"
        >
          <ArrowUp className="size-4" />
        </Button>
      </form>
      {/* Says WHY it's shut. A dead composer with no explanation is what makes
          a slow turn look broken. */}
      <p className="text-kicker mx-auto mt-1.5 max-w-3xl px-1 font-mono text-[11px] tracking-[0.12em] uppercase">
        {disabled ? "Working — one question at a time" : "⌘↵ to send"}
      </p>
    </div>
  );
}
