"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { AskAiMark } from "@/components/brand/ask-ai-mark";
import { Kicker } from "@/components/ui/kicker";

export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
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
 * The conversation transcript. Renders persisted turns, then the live streaming
 * assistant bubble (token deltas) and a status line ("Consulting N boards…")
 * while a turn is in flight. Auto-scrolls to the newest content.
 */
export function MessageList({
  messages,
  streamingText,
  status,
}: {
  messages: UIMessage[];
  streamingText: string | null;
  status: string | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streamingText, status]);

  const empty = messages.length === 0 && streamingText === null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
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

        {messages.map((m) => (
          <Bubble key={m.id} role={m.role} content={m.content} />
        ))}

        {streamingText !== null ? (
          <Bubble
            role="assistant"
            content={streamingText || (status ? "" : "…")}
          />
        ) : null}

        {status ? (
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

        <div ref={endRef} />
      </div>
    </div>
  );
}
