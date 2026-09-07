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
 * `ai_conversations.agent_id` is AUTHORITATIVE; the newest user turn is the
 * FALLBACK. The column is the only thing the header switcher writes
 * (`setConversationAgent`), so any rule that let a stamped message outrank it
 * made the switcher a no-op: the chip moved, every following turn kept routing
 * to the agent the last question happened to address, and — worse — handing a
 * thread back to the plain Monolith assistant became impossible, because the
 * old agent's id was still sitting on a message. The escape hatch the spec
 * requires only exists if the column wins.
 *
 * The fallback is a REPAIR, not a second opinion: `appendUserMessage` stamps the
 * message and only then best-effort-writes the column, so a lost write must not
 * lose the agent the turn actually addressed. It reads the NEWEST user turn and
 * stops there — including when that turn's `agent_id` is null. A null on the
 * newest user turn is now meaningful ("this thread was handed back to the plain
 * assistant"); scanning past it to an older stamped turn would resurrect the
 * agent the owner just dismissed. Threads written before per-message routing
 * carry null on every turn AND on the column, so they answer null either way.
 */
export function currentPersonaFrom(
  rows: MessageRow[],
  conversationAgentId: string | null,
): string | null {
  if (conversationAgentId) return conversationAgentId;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (r.role === "user") return r.agent_id;
  }
  return null;
}

/** The thread's title, persona and OWNER, for a surface that has the id but not
 *  the rows — the existing-conversation page's header, which needs all three
 *  without a second round-trip. `ownerId` rides along on the same single-row
 *  read because `ai_conversations_select_board_shared` lets any member of the
 *  board READ a shared thread: "the page rendered" no longer implies "this is
 *  my thread", and only the owner may be offered the switcher and the composer.
 *  One indexed single-row read; degrades to nulls rather than throwing — a
 *  thread that renders with a placeholder title and the plain assistant beats a
 *  500, and a null `ownerId` matches no user, so the degraded page is
 *  read-only rather than falsely writable. */
export async function getConversationHeader(conversationId: string): Promise<{
  title: string | null;
  agentId: string | null;
  ownerId: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("title, agent_id, user_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) {
    console.error(`[ask] header read failed for ${conversationId}`, error);
    return { title: null, agentId: null, ownerId: null };
  }
  return {
    title: data?.title ?? null,
    agentId: data?.agent_id ?? null,
    ownerId: data?.user_id ?? null,
  };
}
