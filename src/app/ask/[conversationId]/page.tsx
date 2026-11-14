import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import {
  getConversationHeader,
  getMessages,
  toThreadMessages,
} from "@/lib/ai/ask/conversations";
import { AskChat } from "@/components/ai/ask/AskChat";

/**
 * An existing conversation. First paint loads this thread's messages (bounded,
 * indexed — working agreement #5). RLS returns no rows for a non-owner, so a
 * foreign or missing id 404s. Switching threads from the rail lands here as an
 * RSC navigation that legitimately loads *different* server data.
 *
 * `header` seeds the thread header with the thread's real title —
 * `getConversationHeader` is a single indexed row read — on first paint;
 * AskChat owns the live state from there. Every turn is answered by the org
 * assistant.
 *
 * A shared board thread renders here for every MEMBER of that board
 * (`ai_conversations_select_board_shared`), not only its owner — so the page
 * decides who may WRITE. A non-owner gets the transcript and no composer and
 * no Approve/Cancel: each of those is scoped to the owner by RLS. The header
 * read carries `ownerId` for exactly this, and a degraded read (null) reads as
 * "not mine", which fails closed on the write affordances rather than open.
 */
export default async function AskConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const user = await requireUser();
  const [rows, header] = await Promise.all([
    getMessages(conversationId),
    getConversationHeader(conversationId),
  ]);
  if (rows.length === 0) notFound();
  const readOnly = header.ownerId !== user.id;

  // `toThreadMessages` is shared with `recoverConversation`, so a stream that
  // dropped mid-turn recovers to exactly what this reload would have rendered —
  // including an unconfirmed proposal, which survives in tool_trace rather than
  // client state (Approve re-reads it server-side).
  return (
    <AskChat
      conversationId={conversationId}
      initialMessages={toThreadMessages(rows)}
      title={header.title ?? undefined}
      readOnly={readOnly}
    />
  );
}
