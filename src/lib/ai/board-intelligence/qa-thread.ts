"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail } from "@/lib/actions/result";
import { rowToRun } from "./runs";

const TITLE_MAX = 60;

const inputSchema = z.object({
  runId: z.string().uuid(),
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(4000),
});

/**
 * Promote one Q/A pair from the Intelligence tab's ephemeral composer into a
 * real, persisted board thread (spec §3.3).
 *
 * The answer is written VERBATIM, exactly as it streamed to the reader on
 * screen — never re-generated. A second model call here would both cost
 * money and risk landing a different answer than the one the reader is
 * promoting.
 *
 * Written through the caller's OWN client, never the service client — RLS
 * bounds this write exactly as it bounds the run read above it. Modelled on
 * `writeBriefingThread` (`src/lib/agents/briefing-thread.ts`), which does the
 * same two-insert dance for a scheduled agent's briefing: one
 * `ai_conversations` row, then its `ai_messages`, `visibility` omitted so the
 * column default (`private`) is the guarantee.
 *
 * `run_id` is deliberately NOT set on the conversation — that FK points at
 * `user_agent_runs` (the scheduled-agent run table `writeBriefingThread`
 * links to), not `board_intelligence_runs`, which is what `runId` here
 * actually names. Setting it would violate the foreign key.
 *
 * The run read is scoped by BOTH the caller's RLS (owner-only) AND an
 * explicit `org_id` filter, the same belt-and-braces the ask route uses
 * (`src/app/api/board-intelligence/ask/route.ts`): RLS answers "is this run
 * mine", not "is it in the org I currently have active". A user in orgs A and
 * B, holding a run id for a board in B while A is active, would otherwise be
 * able to open that run's Q/A pair into a NEW thread stamped `org_id: A` —
 * org A's ai_conversations row and ledger would carry board-B content the
 * user only has because they are also a member of B. A mismatch reads the
 * same as "not found".
 */
export async function openQaInChat(
  input: unknown,
): Promise<ActionResult<{ conversationId: string }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("That question couldn't be opened in chat.");
  const { runId, question, answer } = parsed.data;

  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");

  const supabase = await createClient();
  const row = await supabase
    .from("board_intelligence_runs")
    .select("*")
    .eq("id", runId)
    .eq("org_id", org.id)
    .maybeSingle();
  const run = row.data ? rowToRun(row.data) : null;
  if (!run) return fail("That brief is no longer available.");

  const conv = await supabase
    .from("ai_conversations")
    .insert({
      org_id: org.id,
      user_id: user.id,
      board_id: run.boardId,
      title: question.slice(0, TITLE_MAX),
      // `visibility` omitted on purpose: the column default 'private' is the
      // guarantee, exactly as in `writeBriefingThread`.
    })
    .select("id")
    .single();
  if (conv.error || !conv.data) return fail("Couldn't start that thread.");

  const msgs = await supabase.from("ai_messages").insert([
    { conversation_id: conv.data.id, role: "user", content: question },
    { conversation_id: conv.data.id, role: "assistant", content: answer },
  ]);
  // A thread with no turns is worse than no thread: an empty row in the
  // reader's ledger they cannot make sense of. Clean it up rather than leave
  // it behind.
  if (msgs.error) {
    await supabase.from("ai_conversations").delete().eq("id", conv.data.id);
    return fail("Couldn't save that answer to a thread.");
  }

  return { ok: true, data: { conversationId: conv.data.id } };
}
