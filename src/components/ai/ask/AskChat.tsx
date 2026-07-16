"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  appendUserMessage,
  createConversation,
} from "@/lib/ai/ask/conversation-actions";
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
  const { streaming, send } = useAskStream();

  async function onSubmit(text: string) {
    let convId = conversationId;
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

    // Accumulate streamed tokens in a closure local so the `done` handler sees
    // the full answer regardless of React's render batching.
    let acc = "";
    setStreamText("");
    setStatus(null);
    await send(convId, (e) => {
      if (e.type === "token") {
        acc += e.text;
        setStreamText(acc);
      } else if (e.type === "status") {
        setStatus(e.text);
      } else if (e.type === "error") {
        setStatus(e.message);
        setStreamText(null);
      } else if (e.type === "done") {
        setMessages((m) => [
          ...m,
          {
            id: e.assistantMessageId || `a-${Date.now()}`,
            role: "assistant",
            content: acc,
          },
        ]);
        setStreamText(null);
        setStatus(null);
        router.refresh(); // refresh rail (titles) once, after completion
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <MessageList
        messages={messages}
        streamingText={streamText}
        status={status}
      />
      <Composer disabled={streaming} onSubmit={onSubmit} />
    </div>
  );
}
