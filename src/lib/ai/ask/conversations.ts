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
  "id" | "role" | "content" | "tool_trace" | "created_at" | "agent_id"
>;

/** Bounded hot-path reads (working agreement #5): the conversation list and a
 *  thread's messages are capped over indexed columns — never an unbounded scan
 *  on a growing table. */
const MESSAGES_LIMIT = 200;

/** Each rail section is bounded on its own. Two reads, not one shared cap: a
 *  week of daily briefings would otherwise push every chat past a single limit,
 *  which is the bug this split exists to fix. Both are served index-only by the
 *  partial indexes added with `ai_messages.agent_id`. */
export const RAIL_LIMIT = 50;

/** The user's own chats — threads no agent run wrote. */
export async function listChats(userId: string): Promise<ConversationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .is("run_id", null)
    .order("updated_at", { ascending: false })
    .limit(RAIL_LIMIT);
  if (error) throw new Error(`listChats: ${error.message}`);
  return data ?? [];
}

/** Briefings — one per agent run (`writeBriefingThread` sets `run_id`). */
export async function listBriefings(
  userId: string,
): Promise<ConversationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .not("run_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(RAIL_LIMIT);
  if (error) throw new Error(`listBriefings: ${error.message}`);
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
    .select("id, role, content, tool_trace, created_at, agent_id")
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
  /** The agent this turn belongs to — who it was addressed to (user turn) or
   *  who answered it (assistant turn). Null is the plain assistant, which is
   *  every row written before per-message routing existed. */
  agentId: string | null;
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
    agentId: r.agent_id,
  }));
}

/**
 * Who is on duty in this thread.
 *
 * The LAST USER TURN wins over `ai_conversations.agent_id`: the column is
 * rewritten by the same send that writes the message, so the two agree — but
 * the message is the record of what was actually asked, and a persona that
 * disagrees with the last question is the bug this whole slice removes. The
 * column is the fallback for threads written before the column existed, and
 * for a briefing thread whose only turn is the agent's own report.
 */
export function currentPersonaFrom(
  rows: MessageRow[],
  conversationAgentId: string | null,
): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (r.role === "user" && r.agent_id) return r.agent_id;
  }
  return conversationAgentId;
}

/** The thread's title and persona, for a surface that has the id but not the
 *  rows — the existing-conversation page's header, which needs both without a
 *  second round-trip. One indexed single-row read; degrades to nulls rather
 *  than throwing — a thread that renders with a placeholder title and the
 *  plain assistant beats a 500. */
export async function getConversationHeader(
  conversationId: string,
): Promise<{ title: string | null; agentId: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("title, agent_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) {
    console.error(`[ask] header read failed for ${conversationId}`, error);
    return { title: null, agentId: null };
  }
  return { title: data?.title ?? null, agentId: data?.agent_id ?? null };
}
