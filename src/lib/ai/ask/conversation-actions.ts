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

/**
 * Start a new conversation: insert the thread + its first user message, and
 * return the new id. Org/workspace are resolved server-side via the org switcher
 * (resolveActiveOrg) — never trusted from the client, and never getUserOrgs()[0]
 * which would scope a multi-org user to the wrong tenant.
 */
export async function createConversation(input: {
  firstMessage: string;
}): Promise<ActionResult<{ conversationId: string }>> {
  const parsed = messageSchema.safeParse(input.firstMessage);
  if (!parsed.success) return fail("Message must be 1–4000 characters.");
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
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

  revalidatePath("/ask");
  return { ok: true, data: { conversationId: conv.data.id } };
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
