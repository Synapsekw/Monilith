"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { parseToolTrace, type AskToolTrace } from "@/lib/ai/ask/tool-trace";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { Json } from "@/types/database.types";
import { findDescriptor } from "./catalog";
import { MAX_STAGED_CALLS, type StagedCall, type StagedResult } from "./staged";

const idsSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});
const applySchema = idsSchema.extend({
  selectedIds: z.array(z.string().min(1).max(200)).min(1).max(MAX_STAGED_CALLS),
});

export type BatchOutcome = {
  messageId: string;
  content: string;
  trace: AskToolTrace;
  touchedBoardIds: string[];
  agentId: string | null;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Loaded =
  | { ok: true; calls: StagedCall[]; agentId: string | null }
  | { ok: false; error: string };

/**
 * Read the batch back through RLS and refuse it when it is not the caller's
 * or already has an outcome. `ai_messages` has no UPDATE policy, so a batch is
 * resolved by a LATER message that names it, exactly like an Ask proposal.
 */
async function loadBatch(
  supabase: Supabase,
  userId: string,
  conversationId: string,
  messageId: string,
): Promise<Loaded> {
  const conv = await supabase
    .from("ai_conversations")
    .select("user_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (conv.error || !conv.data || conv.data.user_id !== userId)
    return { ok: false, error: "Conversation not found." };

  const row = await supabase
    .from("ai_messages")
    .select("tool_trace, agent_id")
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (row.error || !row.data) return { ok: false, error: "Changes not found." };

  const calls = parseToolTrace(row.data.tool_trace)?.stagedCalls ?? [];
  if (calls.length === 0)
    return { ok: false, error: "That turn has nothing to apply." };

  const prior = await supabase
    .from("ai_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("tool_trace->>resolvesProposal", messageId)
    .limit(1);
  if (prior.data?.length)
    return { ok: false, error: "These changes were already resolved." };

  return { ok: true, calls, agentId: row.data.agent_id };
}

async function insertOutcome(
  supabase: Supabase,
  conversationId: string,
  content: string,
  trace: AskToolTrace,
  touchedBoardIds: string[],
  agentId: string | null,
): Promise<ActionResult<BatchOutcome>> {
  const ins = await supabase
    .from("ai_messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content,
      tool_trace: trace as unknown as Json,
      agent_id: agentId,
    })
    .select("id")
    .single();
  if (ins.error || !ins.data) return fail("Couldn't record the result.");
  return {
    ok: true,
    data: { messageId: ins.data.id, content, trace, touchedBoardIds, agentId },
  };
}

/** Run one staged call under the user's own client. Never throws. */
async function runCall(
  supabase: Supabase,
  actorId: string,
  call: StagedCall,
): Promise<StagedResult> {
  const descriptor = findDescriptor(call.tool);
  if (!descriptor)
    return {
      id: call.id,
      ok: false,
      error: "This change is no longer available.",
    };
  const input = z.object(descriptor.inputSchema).safeParse(call.input);
  if (!input.success)
    return { id: call.id, ok: false, error: "This change is no longer valid." };
  try {
    const r = await descriptor.invoke(
      { getClient: async () => supabase, actorId },
      input.data as Record<string, unknown>,
    );
    if (r.isError)
      return {
        id: call.id,
        ok: false,
        error: r.content.map((c) => c.text).join("\n") || "Failed.",
      };
    return { id: call.id, ok: true };
  } catch (e) {
    return {
      id: call.id,
      ok: false,
      error: e instanceof Error ? e.message : "Failed.",
    };
  }
}

function outcomeLine(call: StagedCall, result: StagedResult): string {
  if (result.skipped) return `Skipped — ${call.summary}`;
  return result.ok
    ? `Done — ${call.summary}`
    : `Failed — ${call.summary}: ${result.error ?? "Failed."}`;
}

/**
 * Apply the rows the user left ticked. No model call and no new charge:
 * running an approved change is deterministic. Each row is re-validated and
 * runs under the user's RLS; one failing row does not stop the others.
 */
export async function applyBatch(input: {
  conversationId: string;
  messageId: string;
  selectedIds: string[];
}): Promise<ActionResult<BatchOutcome>> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return fail("Pick at least one change to apply.");
  const { conversationId, messageId, selectedIds } = parsed.data;

  try {
    const user = await requireUser();
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");
    const entitlement = await getAiEntitlement(org.id);
    if (entitlement.mode === "off")
      return fail("AI is turned off for your organization.");

    const supabase = await createClient();
    const loaded = await loadBatch(
      supabase,
      user.id,
      conversationId,
      messageId,
    );
    if (!loaded.ok) return fail(loaded.error);

    const selected = new Set(selectedIds);
    const results: StagedResult[] = [];
    const touched = new Set<string>();
    for (const call of loaded.calls) {
      if (!selected.has(call.id)) {
        results.push({ id: call.id, ok: false, skipped: true });
        continue;
      }
      const result = await runCall(supabase, user.id, call);
      results.push(result);
      if (result.ok && call.boardId) touched.add(call.boardId);
    }

    return await insertOutcome(
      supabase,
      conversationId,
      loaded.calls.map((c, i) => outcomeLine(c, results[i]!)).join("\n"),
      {
        resolvesProposal: messageId,
        outcome: "applied",
        stagedResults: results,
      },
      [...touched],
      loaded.agentId,
    );
  } catch {
    return fail("Couldn't apply those changes. Please try again.");
  }
}

/** Decline the whole batch. Persisted so the card stays resolved after a reload. */
export async function dismissBatch(input: {
  conversationId: string;
  messageId: string;
}): Promise<ActionResult<BatchOutcome>> {
  const parsed = idsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  const { conversationId, messageId } = parsed.data;

  try {
    const user = await requireUser();
    const supabase = await createClient();
    const loaded = await loadBatch(
      supabase,
      user.id,
      conversationId,
      messageId,
    );
    if (!loaded.ok) return fail(loaded.error);
    return await insertOutcome(
      supabase,
      conversationId,
      "Dismissed — nothing was changed.",
      { resolvesProposal: messageId, outcome: "cancelled" },
      [],
      loaded.agentId,
    );
  } catch {
    return fail("Couldn't dismiss that. Please try again.");
  }
}
