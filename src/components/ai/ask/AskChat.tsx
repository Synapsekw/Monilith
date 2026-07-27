"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  appendUserMessage,
  createConversation,
  recoverConversation,
} from "@/lib/ai/ask/conversation-actions";
import {
  applyAskProposal,
  cancelAskProposal,
} from "@/lib/ai/ask/proposal-actions";
import { PROPOSAL_FALLBACK_ANSWER } from "@/lib/ai/ask/stream-protocol";
import type { ValidatedAction } from "@/lib/ai/write/schema";
import { useAskStream } from "./use-ask-stream";
import { MessageList, type UIMessage } from "./MessageList";
import type { DropState } from "./StreamDropNotice";
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
 *
 * A turn's stream can also end ABNORMALLY — no `done`, no `error`, just a dead
 * body (flaky mobile, a dev-server rebuild). That used to render nothing at all
 * while the answer sat persisted server-side (gotcha-61). Now it triggers one
 * automatic `recoverConversation` read — the hard refresh that fixed it, minus
 * the refresh — and, if the turn genuinely hasn't landed yet, a notice the user
 * can retry from.
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
  const [dropState, setDropState] = useState<DropState>("none");
  const [, startTransition] = useTransition();
  const { streaming, send } = useAskStream();

  /**
   * The stream died mid-turn. Re-read the thread: the assistant turn has very
   * often already been persisted, in which case the user gets their real answer
   * (proposal card and all) instead of silence. One bounded, indexed, read-only
   * round-trip — cheap and idempotent enough to run without asking.
   *
   * "Did it land?" is one predicate: threads always end on the assistant's turn
   * once it exists, because the user's turn is persisted before the stream opens.
   */
  async function recoverAfterDrop(convId: string) {
    setStreamText(null);
    setStatus(null);
    setDropState("checking");
    const res = await recoverConversation({ conversationId: convId });
    if (res.ok && res.data.messages.at(-1)?.role === "assistant") {
      setMessages(res.data.messages);
      setDropState("recovered");
      router.refresh(); // the turn may have auto-titled the thread
    } else {
      setDropState("unrecovered");
    }
  }

  async function onSubmit(text: string) {
    let convId = activeId;
    setDropState("none");
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
    const outcome = await send(convId, (e) => {
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

    if (outcome === "dropped") await recoverAfterDrop(convId);
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
        dropState={dropState}
        onRetryDrop={() => {
          if (activeId) void recoverAfterDrop(activeId);
        }}
      />
      {/* Never stranded: the composer is dead only while a turn or a recovery
          check is genuinely in flight. */}
      <Composer
        disabled={streaming || dropState === "checking"}
        onSubmit={onSubmit}
      />
    </div>
  );
}
