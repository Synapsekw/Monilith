import "server-only";
import { createClient } from "@/lib/supabase/server";
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
