import { notFound } from "next/navigation";
import { getMessages } from "@/lib/ai/ask/conversations";
import { parseToolTrace } from "@/lib/ai/ask/tool-trace";
import { AskChat } from "@/components/ai/ask/AskChat";

/**
 * An existing conversation. First paint loads this thread's messages (bounded,
 * indexed — working agreement #5). RLS returns no rows for a non-owner, so a
 * foreign or missing id 404s. Switching threads from the rail lands here as an
 * RSC navigation that legitimately loads *different* server data.
 */
export default async function AskConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const rows = await getMessages(conversationId);
  if (rows.length === 0) notFound();

  return (
    <AskChat
      conversationId={conversationId}
      initialMessages={rows.map((r) => ({
        id: r.id,
        // DB stores role as text (CHECK-constrained to these two values).
        role: r.role as "user" | "assistant",
        content: r.content,
        // An unconfirmed proposal survives a reload: it lives in tool_trace,
        // not client state, and Approve re-reads it server-side.
        trace: parseToolTrace(r.tool_trace),
      }))}
    />
  );
}
