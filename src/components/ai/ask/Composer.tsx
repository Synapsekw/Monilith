"use client";

import { useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  activeMentionQuery,
  applyMention,
  mentionLabel,
  type AgentMentionTarget,
  type MentionTarget,
} from "@/lib/collaboration/mentions";

const MIN = 1;
const MAX = 4000;
const SUGGESTIONS = 6;

/** Stable empty default — a fresh `[]` literal would give every render a new
 *  identity for a list that is almost always absent (the board dock). */
const NO_AGENTS: readonly MentionTarget[] = [];

/**
 * The agent a message is ADDRESSED to: an `@handle` that LEADS the text.
 *
 * Leading, not anywhere: "@ops what is late?" picks the persona, while "ask
 * @ops later" is a sentence that happens to name one. A handle nobody owns
 * resolves to null — the question is still a perfectly good question, and
 * silently dropping it (or erroring) would be worse than answering it as the
 * default assistant.
 */
function leadingAgent(
  text: string,
  agents: readonly MentionTarget[],
): AgentMentionTarget | null {
  const match = /^@(\S+)/.exec(text.trim());
  if (!match) return null;
  const handle = match[1]!.toLowerCase();
  return (
    agents.find(
      (a): a is AgentMentionTarget =>
        a.kind === "agent" && a.handle.toLowerCase() === handle,
    ) ?? null
  );
}

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
  onSubmit,
}: {
  disabled: boolean;
  /** The owner's agents, addressable by `@handle`. Absent on surfaces that
   *  don't offer a persona (the board dock), where the picker never opens. */
  agents?: readonly MentionTarget[];
  /** `agentId` is the persona a LEADING handle addressed, or null. */
  onSubmit: (text: string, agentId: string | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [query, setQuery] = useState<{ query: string; start: number } | null>(
    null,
  );
  const trimmed = value.trim();
  const canSend = trimmed.length >= MIN && trimmed.length <= MAX && !disabled;
  const addressed = leadingAgent(value, agents);

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

  function send() {
    if (!canSend) return;
    onSubmit(trimmed, leadingAgent(trimmed, agents)?.agentId ?? null);
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
            placeholder="Ask about your boards…"
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
      </div>
      {/* Says WHY it's shut. A dead composer with no explanation is what makes
          a slow turn look broken — and WHO it will reach, so a typed handle is
          confirmed before the question is spent on the wrong persona. */}
      <p className="text-kicker text-2xs mx-auto mt-1.5 max-w-3xl px-1 font-mono tracking-[0.12em] uppercase">
        {disabled
          ? "Working — one question at a time"
          : addressed
            ? `Asking ${addressed.name} — ⌘↵ to send`
            : "⌘↵ to send"}
      </p>
    </div>
  );
}
