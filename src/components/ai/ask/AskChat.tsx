"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  appendUserMessage,
  createConversation,
} from "@/lib/ai/ask/conversation-actions";
import {
  applyAskProposal,
  cancelAskProposal,
} from "@/lib/ai/ask/proposal-actions";
import { PROPOSAL_FALLBACK_ANSWER } from "@/lib/ai/ask/stream-protocol";
import type { ValidatedAction } from "@/lib/ai/write/schema";
import { useAskStream } from "./use-ask-stream";
import { MessageList, type UIMessage } from "./MessageList";
import { Composer } from "./Composer";

/**
 * Client controller for a single chat surface.
 *
 * Data-fetching budget (working agreement #5): sending in an existing thread and
 * streaming tokens are 0-RSC-navigation — token deltas append to client state
 * only. Starting a NEW chat rewrites the URL via `history.pushState` (no RSC
 * re-run). Send / rename / delete are Server Actions; switching to another
 * thread (from the rail) is a legitimate RSC load of *different* data. After a
 * completed turn we `router.refresh()` once so the rail picks up a new
 * auto-title.
 *
 * Phase 2: a turn can end at a confirm card. The `proposal` event arrives before
 * the message is persisted, so its actions are stashed and bound to the real
 * `assistantMessageId` at `done`. Approve/Cancel are Server Actions that take
 * only ids — the actions themselves are re-read server-side from the message
 * row through RLS — and their outcome turn is appended to client state, so
 * confirming costs exactly ONE round-trip and zero RSC navigations.
 */
export function AskChat({
  conversationId,
  initialMessages,
}: {
  conversationId: string | null;
  initialMessages: UIMessage[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // The live conversation id. The prop is null on /ask until the first send
  // mints one — without tracking it here, Approve on a first-turn proposal
  // would have no conversation to address.
  const [activeId, setActiveId] = useState<string | null>(conversationId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { streaming, send } = useAskStream();

  async function onSubmit(text: string) {
    let convId = activeId;
    setMessages((m) => [
      ...m,
      { id: `tmp-${Date.now()}`, role: "user", content: text },
    ]);

    if (!convId) {
      const res = await createConversation({ firstMessage: text });
      if (!res.ok) {
        setStatus(res.error);
        return;
      }
      convId = res.data.conversationId;
      setActiveId(convId);
      // Client nav — no RSC refetch (working agreement #5).
      window.history.pushState(null, "", `/ask/${convId}`);
    } else {
      const res = await appendUserMessage({
        conversationId: convId,
        content: text,
      });
      if (!res.ok) {
        setStatus(res.error);
        return;
      }
    }

    // Accumulate streamed tokens and any proposal in closure locals so the
    // `done` handler sees both regardless of React's render batching.
    let acc = "";
    let proposed: ValidatedAction[] = [];
    setStreamText("");
    setStatus(null);
    await send(convId, (e) => {
      if (e.type === "token") {
        acc += e.text;
        setStreamText(acc);
      } else if (e.type === "status") {
        setStatus(e.text);
      } else if (e.type === "proposal") {
        proposed = e.actions;
      } else if (e.type === "error") {
        setStatus(e.message);
        setStreamText(null);
      } else if (e.type === "done") {
        setMessages((m) => [
          ...m,
          {
            id: e.assistantMessageId || `a-${Date.now()}`,
            role: "assistant",
            content: acc || (proposed.length ? PROPOSAL_FALLBACK_ANSWER : ""),
            trace: proposed.length
              ? {
                  boardsConsulted: e.boardsConsulted,
                  proposedActions: proposed,
                }
              : null,
          },
        ]);
        setStreamText(null);
        setStatus(null);
        router.refresh(); // refresh rail (titles) once, after completion
      }
    });
  }

  /** Approve or decline a proposal. Both append the server's outcome turn,
   *  which is what flips the card out of `idle` (see resolveProposalStates). */
  function resolve(messageId: string, approve: boolean) {
    if (!activeId || busyId) return;
    setBusyId(messageId);
    setStatus(null);
    startTransition(async () => {
      const action = approve ? applyAskProposal : cancelAskProposal;
      const res = await action({ conversationId: activeId, messageId });
      setBusyId(null);
      if (!res.ok) {
        setStatus(res.error);
        return;
      }
      setMessages((m) => [
        ...m,
        {
          id: res.data.messageId,
          role: "assistant",
          content: res.data.content,
          trace: res.data.trace,
        },
      ]);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <MessageList
        messages={messages}
        streamingText={streamText}
        status={status}
        busyMessageId={busyId}
        onApprove={(id) => resolve(id, true)}
        onCancel={(id) => resolve(id, false)}
      />
      <Composer disabled={streaming} onSubmit={onSubmit} />
    </div>
  );
}
