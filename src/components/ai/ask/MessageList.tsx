"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { AskAiMark } from "@/components/brand/ask-ai-mark";
import { EmptyState } from "@/components/ui/empty-state";
import { Kicker } from "@/components/ui/kicker";
import { ActionConfirmCard } from "@/components/ai/actions/ActionConfirmCard";
import { BatchConfirmCard } from "@/components/ai/assistant/BatchConfirmCard";
import { StreamDropNotice, type DropState } from "./StreamDropNotice";
import { ThinkingIndicator } from "./ThinkingIndicator";
import {
  resolveProposalStates,
  type AskToolTrace,
} from "@/lib/ai/ask/tool-trace";
import type { ChatSurface } from "./surface";

/** What every assistant turn is called: the org assistant answers them all. */
const PLAIN_ASSISTANT_NAME = "Monolith";

/** What an undecided proposal says to someone who cannot decide it. */
const OWNER_DECIDES_NOTE = "Only this thread's owner can decide this.";

export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Parsed `ai_messages.tool_trace`. Carries a turn's proposed actions, or —
   *  on an outcome turn — which proposal it resolved. */
  trace?: AskToolTrace | null;
};

/** Atmosphere entrance (spec §5): each turn slides in 14px from the right on
 *  mount via `@starting-style`, the first three staggered, the rest flat.
 *  Transitions on `translate` (Tailwind v4's translate utilities write the
 *  `translate` property, not `transform`), so the global reduced-motion rule
 *  collapses them like everything else. */
const TURN_ENTRANCE =
  "starting:translate-x-3.5 starting:opacity-0 ease-keystone transition-[opacity,translate] duration-[360ms] [&:nth-child(1)]:delay-[120ms] [&:nth-child(2)]:delay-[180ms] [&:nth-child(3)]:delay-[240ms]";

/** A single chat turn. User turns sit right in a bubble; assistant turns sit
 *  left, full-width, chrome-neutral — named by a `Kicker` above the text so
 *  the mark (gutter) and the name (label) each do one job.
 *
 *  On the wash (`atmosphere`) the user bubble is the chrome fill rather than a
 *  muted card. */
function Bubble({
  role,
  content,
  agentName,
  surface = "card",
}: {
  role: UIMessage["role"];
  content: string;
  /** Assistant turns only — who answered. Ignored for user turns. */
  agentName?: string;
  surface?: ChatSurface;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className={
            surface === "card"
              ? "bg-surface-muted max-w-[85%] rounded-lg border px-3.5 py-2 text-sm whitespace-pre-wrap"
              : "bg-chrome-fill border-border max-w-[85%] rounded-lg border px-3 py-1.5 text-sm whitespace-pre-wrap"
          }
        >
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <span
        data-turn-tile
        className={
          surface === "card"
            ? "bg-surface text-brand mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border"
            : "bg-chrome-fill text-brand mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm border"
        }
      >
        <AskAiMark className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        {agentName ? <Kicker className="mb-1 block">{agentName}</Kicker> : null}
        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}

/**
 * The conversation transcript. Renders persisted turns, then — while a turn is
 * in flight — either the animated `ThinkingIndicator` (open, no tokens yet) or
 * the live assistant bubble plus a status line ("Consulting N boards…").
 * Auto-scrolls to the newest content.
 *
 * `dropState` is the severed-stream surface (gotcha-61): when a turn's response
 * body ends without `done`, this list must never fall silent.
 */
export function MessageList({
  messages,
  streamingText,
  status,
  onApprove,
  onCancel,
  onApplyBatch,
  onDismissBatch,
  busyMessageId,
  dropState = "none",
  onRetryDrop,
  readOnly = false,
  surface = "card",
}: {
  messages: UIMessage[];
  streamingText: string | null;
  status: string | null;
  onApprove: (messageId: string) => void;
  onCancel: (messageId: string) => void;
  /** Apply the ticked rows of the staged batch on this message. */
  onApplyBatch: (messageId: string, selectedIds: string[]) => void;
  /** Dismiss the staged batch on this message; nothing is changed. */
  onDismissBatch: (messageId: string) => void;
  busyMessageId?: string | null;
  dropState?: DropState;
  onRetryDrop?: () => void;
  /** A thread shared to a board, opened by someone who does not own it. The
   *  transcript still reads; the decisions belong to the owner, and their RLS
   *  scope is what would refuse them anyway. */
  readOnly?: boolean;
  /** `card` (/ask, default) or `atmosphere` (the board dock, on the wash).
   *  Purely presentational — see `surface.ts`. */
  surface?: ChatSurface;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streamingText, status, dropState]);

  const empty = messages.length === 0 && streamingText === null;
  // Pure derivation over the thread — a proposal is resolved by a LATER message
  // naming it, so reload and live-update render identically.
  const proposalStates = resolveProposalStates(messages);
  const emptyMessage = (
    <>
      Ask a question about your boards — what&apos;s overdue, who&apos;s
      overloaded, what shipped this week. Answers are grounded in your real
      data.
    </>
  );

  return (
    <div data-scroll-container className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={
          surface === "card"
            ? "mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6"
            : "flex flex-col gap-3.5 px-3.5 py-2"
        }
      >
        {empty && surface === "card" ? (
          // The /ask page: Mono greets a thread with nothing in it. No actions
          // row — the page's one action is the composer directly below, which
          // already holds focus.
          <EmptyState
            variant="inline"
            mascot="happy"
            title="Your conversation with Monolith will appear here"
            className="mt-[12vh] py-0"
          >
            {emptyMessage}
          </EmptyState>
        ) : empty ? (
          // The board dock keeps its compact mark: Mono is for page-level
          // empty states, not a panel on someone else's page.
          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <span className="bg-primary/15 text-primary flex size-11 items-center justify-center rounded-sm">
              <AskAiMark className="size-5" />
            </span>
            <Kicker>Ask</Kicker>
            <p className="text-muted-foreground max-w-sm text-sm">
              {emptyMessage}
            </p>
          </div>
        ) : null}

        {messages.map((m) => {
          const actions = m.trace?.proposedActions ?? [];
          const stagedCalls = m.trace?.stagedCalls ?? [];
          // NOT named `status` — that is the streaming status-line prop.
          // A viewer sees WHAT was proposed and that it is still open, but no
          // Approve/Cancel: the write is the owner's to make (and RLS would
          // refuse it anyway — a button whose only outcome is failure is
          // worse than no button).
          const resolvedStatus = proposalStates.get(m.id);
          const proposalStatus =
            readOnly && resolvedStatus?.state === "idle"
              ? { state: "done" as const, note: OWNER_DECIDES_NOTE }
              : resolvedStatus;
          return (
            <div
              key={m.id}
              data-turn
              className={cn(
                "flex flex-col gap-3",
                surface === "atmosphere" && TURN_ENTRANCE,
              )}
            >
              <Bubble
                role={m.role}
                content={m.content}
                agentName={
                  m.role === "assistant" ? PLAIN_ASSISTANT_NAME : undefined
                }
                surface={surface}
              />
              {actions.length > 0 && proposalStatus ? (
                // Indented to the assistant gutter (size-7 mark + gap-3), so the
                // card hangs off the turn it belongs to.
                <div className="flex flex-col gap-2 pl-10">
                  {actions.map((action, i) => (
                    <ActionConfirmCard
                      key={i}
                      action={action}
                      state={
                        busyMessageId === m.id
                          ? "running"
                          : proposalStatus.state
                      }
                      resultNote={proposalStatus.note}
                      onApprove={() => onApprove(m.id)}
                      onCancel={() => onCancel(m.id)}
                    />
                  ))}
                </div>
              ) : null}
              {stagedCalls.length > 0 && proposalStatus ? (
                // Same gutter as the legacy cards. Keyed by the message so the
                // card's tick state (initialised once from `calls`) belongs to
                // this turn and survives re-renders of the list.
                <div className="pl-10">
                  <BatchConfirmCard
                    key={m.id}
                    calls={stagedCalls}
                    state={
                      busyMessageId === m.id ? "running" : proposalStatus.state
                    }
                    resultNote={proposalStatus.note}
                    onApply={(ids) => onApplyBatch(m.id, ids)}
                    onDismiss={() => onDismissBatch(m.id)}
                  />
                </div>
              ) : null}
            </div>
          );
        })}

        {/* Three states, in the order a turn passes through them.
            `streamingText` is the discriminator: null = no live turn,
            "" = open but nothing back yet, non-empty = tokens arriving. */}

        {/* Open, no tokens: the 25–42s stretch that used to render a static "…"
            and read as a hung page (gotcha-62). One live region, carrying the
            freshest status — so the status is NOT also drawn below. With no
            status yet, `ThinkingIndicator` falls back to its own generic
            label. */}
        {streamingText === "" ? <ThinkingIndicator label={status} /> : null}

        {streamingText ? (
          <Bubble
            role="assistant"
            content={streamingText}
            agentName={PLAIN_ASSISTANT_NAME}
            surface={surface}
          />
        ) : null}

        {status && streamingText !== "" ? (
          <p
            aria-live="polite"
            className={cn(
              "text-muted-foreground pl-10 text-xs",
              streamingText !== null && "animate-pulse",
            )}
          >
            {status}
          </p>
        ) : null}

        <StreamDropNotice state={dropState} onRetry={() => onRetryDrop?.()} />

        <div ref={endRef} />
      </div>
    </div>
  );
}
