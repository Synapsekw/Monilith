import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseToolTrace, type AskToolTrace } from "@/lib/ai/ask/tool-trace";
import type { Database } from "@/types/database.types";

export type ConversationRow = Pick<
  Database["public"]["Tables"]["ai_conversations"]["Row"],
  "id" | "title" | "updated_at"
>;
export type MessageRow = Pick<
  Database["public"]["Tables"]["ai_messages"]["Row"],
  "id" | "role" | "content" | "tool_trace" | "created_at"
>;

/** Bounded hot-path reads (working agreement #5): the conversation list and a
 *  thread's messages are capped over indexed columns — never an unbounded scan
 *  on a growing table. */
const CONVERSATIONS_LIMIT = 100;
const MESSAGES_LIMIT = 200;

/** List the user's conversations newest-first, bounded. RLS also scopes this to
 *  the caller; the explicit `user_id` filter keeps the read on the
 *  `(user_id, updated_at desc)` index. */
export async function listConversations(
  userId: string,
): Promise<ConversationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(CONVERSATIONS_LIMIT);
  if (error) throw new Error(`listConversations: ${error.message}`);
  return data ?? [];
}

/**
 * The agent run this thread reports on, or null for an ordinary chat.
 *
 * `ai_conversations.run_id` is set only by `writeBriefingThread`, so a non-null
 * answer means "this thread is a briefing" — which is what lets the thread page
 * show the run's queued approvals next to the report that asked for them. A
 * single-row primary-key read, issued in parallel with the messages, and RLS
 * scopes it to the owner exactly as `getMessages` is scoped.
 */
export async function getConversationRunId(
  conversationId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("run_id")
    .eq("id", conversationId)
    .maybeSingle();
  // Never throws: a briefing that renders without its approval cards is a
  // degraded thread; a 500 is no thread at all.
  if (error) {
    console.error(`[ask] run id read failed for ${conversationId}`, error);
    return null;
  }
  return data?.run_id ?? null;
}

/** Load a conversation's turns oldest-first, bounded. RLS returns empty rows for
 *  a non-owner (used by the page to 404). */
export async function getMessages(
  conversationId: string,
): Promise<MessageRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_messages")
    .select("id, role, content, tool_trace, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(MESSAGES_LIMIT);
  if (error) throw new Error(`getMessages: ${error.message}`);
  return data ?? [];
}

/** A persisted turn, shaped for render. Structurally the `UIMessage` the chat
 *  client holds — kept as a plain type so a server module never has to import
 *  from a `"use client"` file. */
export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  trace: AskToolTrace | null;
};

/**
 * Map DB rows to render-ready turns. The ONE mapping used by both first paint
 * (`/ask/[conversationId]`) and mid-turn drop recovery (`recoverConversation`),
 * so a recovered thread is byte-for-byte what a hard reload would have shown —
 * including an unconfirmed proposal's `tool_trace`, which is what keeps its
 * confirm card intact and still actionable.
 */
export function toThreadMessages(rows: MessageRow[]): ThreadMessage[] {
  return rows.map((r) => ({
    id: r.id,
    // DB stores role as text (CHECK-constrained to these two values).
    role: r.role as "user" | "assistant",
    content: r.content,
    trace: parseToolTrace(r.tool_trace),
  }));
}
