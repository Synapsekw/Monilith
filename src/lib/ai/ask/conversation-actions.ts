"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { getActiveWorkspaceId } from "@/lib/workspaces/active";
import {
  getMessages,
  toThreadMessages,
  type ThreadMessage,
} from "@/lib/ai/ask/conversations";
// Canonical shared result type — never re-declare locally (AGENTS.md invariant).
import { type ActionResult, fail } from "@/lib/actions/result";

// Bounded free text: it flows verbatim into the Anthropic prompt, so an
// unbounded string is a token/cost-abuse vector.
const messageSchema = z.string().trim().min(1).max(4000);
const titleSchema = z.string().trim().min(1).max(120);
const idSchema = z.string().uuid();
const visibilitySchema = z.enum(["private", "board"]);

/**
 * Resolve an agent the CALLER owns, or null.
 *
 * `user_agents` is owner-scoped by RLS, so a foreign or non-existent id reads
 * back as null through the user client — the check and the query are the same
 * statement. Never accept an agent id on trust: the persona it selects becomes
 * part of the system prompt.
 */
async function ownedAgentId(agentId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_agents")
    .select("id")
    .eq("id", agentId)
    .maybeSingle();
  return data?.id ?? null;
}

/** A board the caller may read, together with the org it lives in. */
type ReadableBoard = { id: string; orgId: string };

/**
 * Resolve a board the CALLER can read, or null.
 *
 * `boards`' SELECT policy is `is_org_member(org_id) AND (created_by =
 * auth.uid() OR is_board_member(id))` — exactly the predicate
 * `can_read_board()` evaluates — so an RLS-scoped read through the user client
 * fails closed identically, and the check and the query are one statement. Same
 * shape as `ownedAgentId` above, and for the same reason: a uuid-SHAPED board id
 * is not a board the caller may write to — otherwise a trusted `boardId` would
 * let any authenticated user place a titled, attacker-authored thread into a
 * foreign board's dock by sharing it afterwards.
 *
 * `org_id` rides along on the SAME single-row lookup — no extra round-trip — so
 * the caller can check that the board's org is the org this request is acting
 * as. Since 2026-08-04 the database enforces that coupling too:
 * `ai_conversations_board_org_fkey` is a composite FK `(board_id, org_id) ->
 * boards (id, org_id)`, so a mismatched pair is refused by Postgres even if this
 * guard is ever bypassed. The guard exists to make the refusal a sentence rather
 * than a SQLSTATE; the constraint is the invariant.
 */
async function readableBoard(boardId: string): Promise<ReadableBoard | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("boards")
    .select("id, org_id")
    .eq("id", boardId)
    .maybeSingle();
  return data ? { id: data.id, orgId: data.org_id } : null;
}

/**
 * Start a new conversation: insert the thread + its first user message, and
 * return the new id. Org/workspace are resolved server-side via the org switcher
 * (resolveActiveOrg) — never trusted from the client, and never getUserOrgs()[0]
 * which would scope a multi-org user to the wrong tenant.
 *
 * `boardId`/`agentId` are optional: `/ask` calls this with neither and keeps
 * behaving exactly as before (plain thread, revalidates `/ask`). The board
 * dock passes both to open a thread scoped to that board and agent.
 */
export async function createConversation(input: {
  firstMessage: string;
  boardId?: string;
  agentId?: string;
}): Promise<ActionResult<{ conversationId: string }>> {
  const parsed = messageSchema.safeParse(input.firstMessage);
  if (!parsed.success) return fail("Message must be 1–4000 characters.");

  let board: ReadableBoard | null = null;
  if (input.boardId !== undefined) {
    const b = idSchema.safeParse(input.boardId);
    if (!b.success) return fail("Invalid board.");
    board = await readableBoard(b.data);
    // Fails CLOSED, and with one message for both "not yours" and "not there" —
    // distinguishing them would make this a board-membership oracle.
    if (!board) return fail("Board not found.");
  }

  let agentId: string | null = null;
  if (input.agentId !== undefined) {
    const a = idSchema.safeParse(input.agentId);
    if (!a.success) return fail("Invalid agent.");
    agentId = await ownedAgentId(a.data);
    // Fails CLOSED, and with one message for both "not yours" and "not there" —
    // distinguishing them would make this a membership oracle.
    if (!agentId) return fail("Agent not found.");
  }

  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");

  // The thread's org attribution must be the board's org. Reachable only for a
  // board the caller has already proven they may read, so naming the mismatch
  // leaks nothing readableBoard did not already concede.
  //
  // Deliberately NOT "derive org_id from the board instead": /api/ask/route.ts
  // independently resolves resolveActiveOrg() for requireAiEntitlement() and for
  // usage recording on EVERY turn, so deriving here would stamp the thread org A
  // while every turn in it is billed to org B — an attribution drift traded for a
  // billing drift.
  if (board && board.orgId !== org.id) {
    return fail(
      "This board is in a different organization. Switch to it to chat here.",
    );
  }

  const workspaceId = await getActiveWorkspaceId(
    await listWorkspacesCached(org.id),
  );

  const supabase = await createClient();
  const conv = await supabase
    .from("ai_conversations")
    .insert({
      org_id: org.id,
      user_id: user.id,
      workspace_id: workspaceId || null,
      title: "New chat",
      board_id: board?.id ?? null,
      agent_id: agentId,
      // `visibility` is deliberately omitted: the column default 'private' is
      // what makes the widened SELECT policy unable to match a fresh row.
    })
    .select("id")
    .single();
  if (conv.error || !conv.data) return fail("Couldn't start the conversation.");

  const msg = await supabase.from("ai_messages").insert({
    conversation_id: conv.data.id,
    role: "user",
    content: parsed.data,
  });
  if (msg.error) return fail("Couldn't save your message.");

  // A board thread never revalidates: /ask does not list it in this surface's
  // flow, and revalidating the BOARD path would re-run getBoardPayload on every
  // send — the exact refetch working agreement #5 forbids (gotcha-09).
  if (!board) revalidatePath("/ask");
  return { ok: true, data: { conversationId: conv.data.id } };
}

/**
 * Share a thread with its board, or take it back. RLS scopes the update to the
 * owner, so a board member cannot flip someone else's thread.
 *
 * A thread with no `board_id` can never be shared: the shared-read policy's
 * FIRST conjunct is `board_id is not null`, so `visibility = 'board'` on a
 * boardless thread (a scheduled briefing, or any plain `/ask` thread) is a lie —
 * it paints a "Shared" chip on something no board member can read. It is also a
 * trap: were a later slice to let an owner attach an existing thread to a board,
 * that thread would arrive already carrying `visibility='board'` and become
 * readable the instant `board_id` is set. Refusing here keeps the affordance and
 * the invariant in agreement.
 */
export async function setThreadVisibility(input: {
  conversationId: string;
  visibility: "private" | "board";
}): Promise<ActionResult<{ visibility: string }>> {
  const id = idSchema.safeParse(input.conversationId);
  const vis = visibilitySchema.safeParse(input.visibility);
  if (!id.success) return fail("Invalid conversation.");
  if (!vis.success) return fail("Invalid visibility.");

  const supabase = await createClient();

  // Only the WIDENING direction needs the check — taking a thread back is always
  // safe, and must keep working even on a row whose board has since gone away.
  if (vis.data === "board") {
    const { data: row } = await supabase
      .from("ai_conversations")
      .select("board_id")
      .eq("id", id.data)
      .maybeSingle();
    if (!row?.board_id) {
      return fail("This thread isn't on a board, so it can't be shared here.");
    }
  }

  const { data, error } = await supabase
    .from("ai_conversations")
    .update({ visibility: vis.data })
    .eq("id", id.data)
    .select("id")
    .single();
  if (error || !data) return fail("Couldn't change who can see this thread.");
  return { ok: true, data: { visibility: vis.data } };
}

/** Append a follow-up user message to an existing conversation. */
export async function appendUserMessage(input: {
  conversationId: string;
  content: string;
}): Promise<ActionResult<{ messageId: string }>> {
  const content = messageSchema.safeParse(input.content);
  const id = idSchema.safeParse(input.conversationId);
  if (!content.success || !id.success) return fail("Invalid message.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_messages")
    .insert({ conversation_id: id.data, role: "user", content: content.data })
    .select("id")
    .single();
  if (error || !data) return fail("Couldn't save your message.");
  return { ok: true, data: { messageId: data.id } };
}

/**
 * Re-read a thread after its `/api/ask` stream was severed mid-turn.
 *
 * A dropped stream is NOT a failed turn: the server-side loop keeps running and
 * usually persists the assistant message anyway (gotcha-61 — a 2,594-char reply
 * was sitting in `ai_messages` while the user stared at silence). This is the
 * hard-refresh that fixed it, minus the refresh: one bounded, indexed,
 * RLS-scoped read, mapped exactly as first paint maps it.
 *
 * Read-only and idempotent, so it is safe to run automatically. It reports the
 * thread as-is — whether the answer landed is the caller's call (the last row's
 * role), because only the caller knows what it already had on screen.
 */
export async function recoverConversation(input: {
  conversationId: string;
}): Promise<ActionResult<{ messages: ThreadMessage[] }>> {
  const id = idSchema.safeParse(input.conversationId);
  if (!id.success) return fail("Invalid conversation.");
  try {
    return {
      ok: true,
      data: { messages: toThreadMessages(await getMessages(id.data)) },
    };
  } catch {
    return fail("Couldn't reach the server.");
  }
}

/** Rename a conversation (RLS scopes the update to the owner). */
export async function renameConversation(input: {
  conversationId: string;
  title: string;
}): Promise<ActionResult<{ title: string }>> {
  const title = titleSchema.safeParse(input.title);
  const id = idSchema.safeParse(input.conversationId);
  if (!title.success || !id.success) return fail("Invalid title.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("ai_conversations")
    .update({ title: title.data })
    .eq("id", id.data);
  if (error) return fail("Couldn't rename the conversation.");
  revalidatePath("/ask");
  return { ok: true, data: { title: title.data } };
}

/** Delete a conversation (its messages cascade). RLS scopes to the owner. */
export async function deleteConversation(input: {
  conversationId: string;
}): Promise<ActionResult<Record<string, never>>> {
  const id = idSchema.safeParse(input.conversationId);
  if (!id.success) return fail("Invalid conversation.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("ai_conversations")
    .delete()
    .eq("id", id.data);
  if (error) return fail("Couldn't delete the conversation.");
  revalidatePath("/ask");
  return { ok: true, data: {} };
}
