"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { AskAiMark } from "@/components/brand/ask-ai-mark";
import { Kicker } from "@/components/ui/kicker";
import { ActionConfirmCard } from "@/components/ai/actions/ActionConfirmCard";
import { StreamDropNotice, type DropState } from "./StreamDropNotice";
import { ThinkingIndicator } from "./ThinkingIndicator";
import {
  resolveProposalStates,
  type AskToolTrace,
} from "@/lib/ai/ask/tool-trace";
import {
  isAgentMention,
  type MentionTarget,
} from "@/lib/collaboration/mentions";
import type { ChatSurface } from "./surface";

/** What an assistant turn is called when it has no agent on record — a legacy
 *  row, or a thread never handed to a persona. Distinct from `ThreadHeader`'s
 *  "Monolith assistant" chip on purpose: that names WHO is on duty going
 *  forward, this names WHO already answered — shorter reads better inline,
 *  once per turn, than repeated in a transcript. */
const PLAIN_ASSISTANT_NAME = "Monolith";

/** Stable empty default — a fresh `{}` would give the prop a new identity on
 *  every render of the surfaces that carry no historical names. */
const EMPTY_NAMES: Readonly<Record<string, string>> = {};

/** What an undecided proposal says to someone who cannot decide it. */
const OWNER_DECIDES_NOTE = "Only this thread's owner can decide this.";

export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Parsed `ai_messages.tool_trace`. Carries a turn's proposed actions, or —
   *  on an outcome turn — which proposal it resolved. */
  trace?: AskToolTrace | null;
  /** The agent this turn belongs to — rendered as the assistant turn's kicker
   *  (`nameOf` below). Optional because the client appends turns of its own
   *  mid-stream; absent and null both read as the plain assistant. */
  agentId?: string | null;
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
 *  muted card, and an assistant turn with a real persona carries that agent's
 *  brand-tinted initial — the same tile as its band tile (DockTiles) — while a
 *  plain assistant turn keeps the Ask AI mark. */
function Bubble({
  role,
  content,
  agentName,
  persona = false,
  surface = "card",
}: {
  role: UIMessage["role"];
  content: string;
  /** Assistant turns only — who answered. Ignored for user turns. */
  agentName?: string;
  /** `agentName` is a real agent (resolved from the roster or the historical
   *  names), not the plain-assistant fallback. */
  persona?: boolean;
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
      {surface === "atmosphere" && persona ? (
        <span
          data-turn-tile
          aria-hidden="true"
          className="bg-primary/15 text-primary text-2xs mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm font-bold uppercase"
        >
          {agentName?.slice(0, 1)}
        </span>
      ) : (
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
      )}
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
  busyMessageId,
  dropState = "none",
  onRetryDrop,
  agents = [],
  agentNames = EMPTY_NAMES,
  streamingAgentId = null,
  readOnly = false,
  surface = "card",
}: {
  messages: UIMessage[];
  streamingText: string | null;
  status: string | null;
  onApprove: (messageId: string) => void;
  onCancel: (messageId: string) => void;
  busyMessageId?: string | null;
  dropState?: DropState;
  onRetryDrop?: () => void;
  /** The owner's agents — a pure lookup table for turn attribution, not a
   *  fetch trigger. Also doubles as the empty state's "who you can ask"
   *  list, so an owner with no agents yet gets the same empty state as
   *  before rather than an offer to address nobody. */
  agents?: readonly MentionTarget[];
  /** Names for agents that already ANSWERED in this thread, including ones
   *  since disabled. `agents` is the enabled-only roster (it is also what the
   *  empty state offers to address), so on its own it re-labels every answer a
   *  disabled agent ever gave as "Monolith" — rewriting history to reflect a
   *  setting changed today. Consulted only after the roster misses. */
  agentNames?: Readonly<Record<string, string>>;
  /** Who is answering the LIVE turn (streaming bubble / thinking indicator).
   *  Distinct from any message's `agentId` because the live turn has no
   *  message row yet. */
  streamingAgentId?: string | null;
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
  // Filtered ONCE per render; `nameOf` and the empty-state list both scan
  // this array rather than re-filtering `agents` on every call.
  const agentHandles = agents.filter(isAgentMention);
  // A real name, or nothing — the roster first, then the historical names.
  const resolvedName = (id?: string | null) =>
    agentHandles.find((a) => a.agentId === id)?.name ??
    (id ? agentNames[id] : undefined);
  const nameOf = (id?: string | null) =>
    resolvedName(id) ?? PLAIN_ASSISTANT_NAME;
  // Unlike `nameOf`, no "Monolith" fallback: the thinking indicator's own
  // generic label already covers "no agent on record" — this is only truthy
  // when there is a real name to announce.
  const streamingAgent = agentHandles.find(
    (a) => a.agentId === streamingAgentId,
  )?.name;

  return (
    <div data-scroll-container className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={
          surface === "card"
            ? "mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6"
            : "flex flex-col gap-3.5 px-3.5 py-2"
        }
      >
        {empty ? (
          <div
            className={
              surface === "card"
                ? "mt-[12vh] flex flex-col items-center gap-3 text-center"
                : "mt-8 flex flex-col items-center gap-3 text-center"
            }
          >
            <span
              className={
                surface === "card"
                  ? "bg-surface text-brand flex size-11 items-center justify-center rounded-lg border"
                  : "bg-primary/15 text-primary flex size-11 items-center justify-center rounded-sm"
              }
            >
              <AskAiMark className="size-5" />
            </span>
            <Kicker>Agents</Kicker>
            <p className="text-muted-foreground max-w-sm text-sm">
              {agentHandles.length > 0 ? (
                <>
                  Start with{" "}
                  {agentHandles.map((a, i) => (
                    <span key={a.agentId}>
                      <span className="text-foreground font-mono">
                        @{a.handle}
                      </span>
                      {i < agentHandles.length - 1 ? ", " : ""}
                    </span>
                  ))}{" "}
                  — or just ask.
                </>
              ) : (
                <>
                  Ask a question about your boards — what&apos;s overdue,
                  who&apos;s overloaded, what shipped this week. Answers are
                  grounded in your real data.
                </>
              )}
            </p>
          </div>
        ) : null}

        {messages.map((m) => {
          const actions = m.trace?.proposedActions ?? [];
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
                  m.role === "assistant" ? nameOf(m.agentId) : undefined
                }
                persona={
                  m.role === "assistant" &&
                  resolvedName(m.agentId) !== undefined
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
            </div>
          );
        })}

        {/* Three states, in the order a turn passes through them.
            `streamingText` is the discriminator: null = no live turn,
            "" = open but nothing back yet, non-empty = tokens arriving. */}

        {/* Open, no tokens: the 25–42s stretch that used to render a static "…"
            and read as a hung page (gotcha-62). One live region, carrying the
            freshest status — so the status is NOT also drawn below. The label
            names the answering agent once one is known; with no agent on the
            turn, `ThinkingIndicator` falls back to its own generic label
            rather than a hollow "Monolith is working…". */}
        {streamingText === "" ? (
          <ThinkingIndicator
            label={
              status ??
              (streamingAgent ? `${streamingAgent} is working…` : null)
            }
          />
        ) : null}

        {streamingText ? (
          <Bubble
            role="assistant"
            content={streamingText}
            agentName={nameOf(streamingAgentId)}
            persona={resolvedName(streamingAgentId) !== undefined}
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
