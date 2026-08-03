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

export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Parsed `ai_messages.tool_trace`. Carries a turn's proposed actions, or —
   *  on an outcome turn — which proposal it resolved. */
  trace?: AskToolTrace | null;
};

/** A single chat turn. User turns sit right in a muted bubble; assistant turns
 *  sit left, full-width, chrome-neutral. */
function Bubble({
  role,
  content,
}: {
  role: UIMessage["role"];
  content: string;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-surface-muted max-w-[85%] rounded-lg border px-3.5 py-2 text-sm whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <span className="bg-surface text-brand mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border">
        <AskAiMark className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5 text-sm leading-relaxed whitespace-pre-wrap">
        {content}
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
}: {
  messages: UIMessage[];
  streamingText: string | null;
  status: string | null;
  onApprove: (messageId: string) => void;
  onCancel: (messageId: string) => void;
  busyMessageId?: string | null;
  dropState?: DropState;
  onRetryDrop?: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streamingText, status, dropState]);

  const empty = messages.length === 0 && streamingText === null;
  // Pure derivation over the thread — a proposal is resolved by a LATER message
  // naming it, so reload and live-update render identically.
  const proposalStates = resolveProposalStates(messages);

  return (
    <div data-scroll-container className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
        {empty ? (
          <div className="mt-[12vh] flex flex-col items-center gap-3 text-center">
            <span className="bg-surface text-brand flex size-11 items-center justify-center rounded-lg border">
              <AskAiMark className="size-5" />
            </span>
            <Kicker>Ask AI</Kicker>
            <p className="text-muted-foreground max-w-sm text-sm">
              Ask a question about your boards — what&apos;s overdue, who&apos;s
              overloaded, what shipped this week. Answers are grounded in your
              real data.
            </p>
          </div>
        ) : null}

        {messages.map((m) => {
          const actions = m.trace?.proposedActions ?? [];
          // NOT named `status` — that is the streaming status-line prop.
          const proposalStatus = proposalStates.get(m.id);
          return (
            <div key={m.id} className="flex flex-col gap-3">
              <Bubble role={m.role} content={m.content} />
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
            freshest status — so the status is NOT also drawn below. */}
        {streamingText === "" ? <ThinkingIndicator label={status} /> : null}

        {streamingText ? (
          <Bubble role="assistant" content={streamingText} />
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
