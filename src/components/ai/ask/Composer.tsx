"use client";

import { useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { Textarea } from "@/components/ui/textarea";
import type { ChatSurface } from "./surface";

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
  error = null,
  onRetry,
  onSubmit,
  surface = "card",
  speakerName,
}: {
  disabled: boolean;
  /** The parent's last SEND failure (the `createConversation`/
   *  `appendUserMessage` Server Action itself failing — not a mid-stream
   *  error, which the transcript's own status line already carries), or null
   *  when nothing is wrong. Rendered as an assertive `role="alert"` line below
   *  the textarea, distinct from the helper line below it — a plain
   *  (non-live-region) status `<Kicker>`, not announced on its own. */
  error?: string | null;
  /** Resends the exact text that failed. The parent owns what
   *  "the last failed submission" means; this is just its retry trigger. Only
   *  rendered when both `error` and `onRetry` are given. */
  onRetry?: () => void;
  onSubmit: (text: string) => void;
  /** `card` (/ask, default): a strip on the page background with a top
   *  hairline and a centred column. `atmosphere` (the board dock): no strip —
   *  the form itself is the one raised surface on the wash, and it rises into
   *  place on mount. See `surface.ts`. */
  surface?: ChatSurface;
  /** Set when the chat is with a Mono rather than the org assistant. */
  speakerName?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const canSend = trimmed.length >= MIN && trimmed.length <= MAX && !disabled;

  function send() {
    if (!canSend) return;
    onSubmit(trimmed);
    setValue("");
  }

  const card = surface === "card";
  return (
    <div
      className={
        card
          ? "bg-background border-t px-4 py-3"
          : "ease-keystone px-2.5 pb-2.5 transition-[opacity,translate] delay-[200ms] duration-[360ms] starting:translate-y-2.5 starting:opacity-0"
      }
    >
      <div className={card ? "relative mx-auto max-w-3xl" : "relative"}>
        <form
          className={
            card
              ? "bg-surface focus-within:border-border-bright flex items-end gap-2 rounded-lg border p-2 transition-colors"
              : "bg-surface border-border shadow-content-lift hover:border-border-hover focus-within:border-border-bright flex items-end gap-2 rounded-lg border p-2 transition-colors"
          }
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            ref={ref}
            autoFocus
            rows={1}
            value={value}
            disabled={disabled}
            placeholder={
              speakerName ? `Message ${speakerName}…` : "Ask about your boards…"
            }
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
        {/* The last send failure. Assertive (`role="alert"`) on purpose — this
            is the composer refusing to have sent anything, not a narration of
            an in-flight turn, so it interrupts the same way a form validation
            error would. Retry resends the exact text the parent
            held onto; a caller with nothing to resend just omits `onRetry`. */}
        {error ? (
          <div
            role="alert"
            className="text-destructive flex items-center gap-2 px-1 text-xs"
          >
            <span>{error}</span>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="underline underline-offset-2"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {/* Says WHY it's shut. A dead composer with no explanation is what makes
          a slow turn look broken. */}
      <Kicker
        className={
          card ? "mx-auto mt-1.5 block max-w-3xl px-1" : "mt-1.5 block px-1"
        }
      >
        {disabled ? "Working — one question at a time" : "⌘↵ to send"}
      </Kicker>
    </div>
  );
}
