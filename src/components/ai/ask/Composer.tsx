"use client";

import { useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { Textarea } from "@/components/ui/textarea";
import {
  activeMentionQuery,
  applyMention,
  isAgentMention,
  mentionLabel,
  type AgentMentionTarget,
  type MentionTarget,
} from "@/lib/collaboration/mentions";
import { resolveAddressedAgent } from "@/lib/ai/ask/persona-routing";

const MIN = 1;
const MAX = 4000;
const SUGGESTIONS = 6;

/** Stable empty default — a fresh `[]` literal would give every render a new
 *  identity for a list that is almost always absent (the board dock). */
const NO_AGENTS: readonly MentionTarget[] = [];

/**
 * Chat composer: a growing textarea + submit. ⌘/Ctrl+Enter sends (mirrors the
 * retired AskPulse popup). Clears on a successful hand-off; stays disabled for
 * the whole of an in-flight turn.
 *
 * `disabled` is an affordance, not the guard — the real one-turn-at-a-time
 * check lives in AskChat, which owns the turn (gotcha-62).
 *
 * Typing `@` opens the same mention picker the item panel uses
 * (`activeMentionQuery` / `applyMention`), so a handle is completed exactly the
 * way it is in an update — one interaction model, not two. Filtering is pure
 * client state over a list the page already loaded: a keystroke costs ZERO
 * server round-trips (working agreement #5).
 */
export function Composer({
  disabled,
  agents = NO_AGENTS,
  agentId = null,
  error = null,
  onRetry,
  onSubmit,
}: {
  disabled: boolean;
  /** The owner's agents, addressable by `@handle`. Absent on surfaces that
   *  don't offer a persona (the board dock), where the picker and the chip
   *  row never appear. */
  agents?: readonly MentionTarget[];
  /** The thread's current persona (sticky), or null for the plain assistant.
   *  Named in the helper line when nothing typed overrides it — the same
   *  `resolveAddressedAgent` the server uses, so the two can never disagree. */
  agentId?: string | null;
  /** The parent's last SEND failure (the `createConversation`/
   *  `appendUserMessage` Server Action itself failing — not a mid-stream
   *  error, which the transcript's own status line already carries), or null
   *  when nothing is wrong. Rendered as an assertive `role="alert"` line below
   *  the textarea, distinct from the helper line below it — a plain
   *  (non-live-region) status `<Kicker>`, not announced on its own. */
  error?: string | null;
  /** Resends the exact (text, agentId) that failed. The parent owns what
   *  "the last failed submission" means; this is just its retry trigger. Only
   *  rendered when both `error` and `onRetry` are given. */
  onRetry?: () => void;
  /** `agentId` is the persona a LEADING typed handle addressed, or null — the
   *  server re-resolves (and applies the sticky fallback) regardless. */
  onSubmit: (text: string, agentId: string | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [query, setQuery] = useState<{ query: string; start: number } | null>(
    null,
  );
  const trimmed = value.trim();
  const canSend = trimmed.length >= MIN && trimmed.length <= MAX && !disabled;
  const roster = agents.filter(isAgentMention);
  // Who answers if sent right now: a leading typed handle wins, otherwise the
  // thread's sticky persona. Same helper the server calls post-send, so the
  // helper line can never promise a different agent than the one who shows up.
  const { agentId: answeringId } = resolveAddressedAgent({
    text: value,
    roster,
    currentAgentId: agentId,
  });
  const answering = roster.find((a) => a.agentId === answeringId);

  const suggestions =
    query && agents.length > 0
      ? agents
          .filter((t) =>
            mentionLabel(t)
              .slice(1)
              .toLowerCase()
              .includes(query.query.toLowerCase()),
          )
          .slice(0, SUGGESTIONS)
      : [];

  function choose(target: MentionTarget) {
    const ta = ref.current;
    // Derive the caret from the query that produced this suggestion, not from
    // the live DOM selection: a mouseDown on the list can land before the
    // textarea has a caret, and `selectionStart` is then 0 — which would splice
    // the handle in at the START of the draft (MentionTextarea, same reason).
    const caret = query
      ? query.start + 1 + query.query.length
      : (ta?.selectionStart ?? value.length);
    setValue(applyMention(value, caret, target).text);
    setQuery(null);
    queueMicrotask(() => ta?.focus());
  }

  /** One-tap chip insertion: append `@handle ` to the end of the draft (there
   *  is no active `@` query to splice into, unlike the picker's `choose`) and
   *  hand focus back to the textarea. Goes through `applyMention` rather than
   *  string surgery so a chip and a typed mention produce identical text. */
  function addChip(target: AgentMentionTarget) {
    setValue((current) => applyMention(current, current.length, target).text);
    setQuery(null);
    queueMicrotask(() => ref.current?.focus());
  }

  function send() {
    if (!canSend) return;
    // The TYPED handle only — never the sticky persona. The server resolves
    // the sticky fallback itself; sending it here would just be a stale
    // second opinion the moment the thread's persona changes mid-draft.
    onSubmit(
      trimmed,
      resolveAddressedAgent({ text: trimmed, roster, currentAgentId: null })
        .agentId,
    );
    setValue("");
    setQuery(null);
  }

  return (
    <div className="bg-background border-t px-4 py-3">
      <div className="relative mx-auto max-w-3xl">
        {suggestions.length > 0 && (
          <ul
            aria-label="Agents"
            className="bg-surface border-border shadow-panel absolute bottom-full left-0 z-50 mb-1.5 w-64 overflow-hidden rounded-lg border"
          >
            {suggestions.map((t) => (
              <li key={mentionLabel(t)}>
                <button
                  type="button"
                  className="hover:bg-state-hover flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(t);
                  }}
                >
                  <span className="truncate">{mentionLabel(t)}</span>
                  {t.kind === "agent" && (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {t.name}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="bg-surface focus-within:border-border-bright flex items-end gap-2 rounded-lg border p-2 transition-colors"
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
              agents.length > 0 ? "Ask your agents…" : "Ask about your boards…"
            }
            aria-label="Your question"
            className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-1.5 py-1.5 shadow-none focus-visible:border-0 focus-visible:ring-0"
            onChange={(e) => {
              setValue(e.target.value);
              setQuery(
                activeMentionQuery(
                  e.target.value,
                  e.target.selectionStart ?? e.target.value.length,
                ),
              );
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            onKeyUp={(e) =>
              setQuery(
                activeMentionQuery(
                  e.currentTarget.value,
                  e.currentTarget.selectionStart ?? 0,
                ),
              )
            }
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
            error would. Retry resends the exact (text, agentId) the parent
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
        {/* One-tap addressing: a chip per agent inserts its handle exactly the
            way typing it would (`applyMention`), so this is a shortcut for the
            picker above, not a second interaction model. Hidden with the
            picker on surfaces with no agents to offer (the board dock), and
            while the picker itself is open — the two would otherwise offer
            the same agent's name twice in one screen. */}
        {roster.length > 0 && suggestions.length === 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {roster.map((a) => (
              <Button
                key={a.agentId}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addChip(a)}
              >
                {mentionLabel(a)}
              </Button>
            ))}
          </div>
        )}
      </div>
      {/* Says WHY it's shut. A dead composer with no explanation is what makes
          a slow turn look broken — and WHO it will reach, so both a typed
          handle and the thread's sticky persona are confirmed before the
          question is spent on the wrong agent. */}
      <Kicker className="mx-auto mt-1.5 block max-w-3xl px-1">
        {disabled
          ? "Working — one question at a time"
          : answering
            ? `Asking ${answering.name} — ⌘↵ to send`
            : "⌘↵ to send"}
      </Kicker>
    </div>
  );
}
