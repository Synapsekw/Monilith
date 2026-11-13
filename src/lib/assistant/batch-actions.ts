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
import { takesOrgId } from "./org-pin";
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
  orgId: string,
  conversationId: string,
  messageId: string,
): Promise<Loaded> {
  const conv = await supabase
    .from("ai_conversations")
    .select("user_id, org_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (
    conv.error ||
    !conv.data ||
    conv.data.user_id !== userId ||
    conv.data.org_id !== orgId
  )
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
  // Fail closed: this query is the only guard against a double write.
  if (prior.error)
    return {
      ok: false,
      error: "Couldn't check those changes. Please try again.",
    };
  if (prior.data?.length)
    return { ok: false, error: "These changes were already resolved." };

  return { ok: true, calls, agentId: row.data.agent_id };
}

/** Insert the outcome turn. Returns its id, or null when the insert failed. */
async function insertOutcomeRow(
  supabase: Supabase,
  conversationId: string,
  content: string,
  trace: AskToolTrace,
  agentId: string | null,
): Promise<string | null> {
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
  return ins.error || !ins.data ? null : ins.data.id;
}

async function insertOutcome(
  supabase: Supabase,
  conversationId: string,
  content: string,
  trace: AskToolTrace,
  touchedBoardIds: string[],
  agentId: string | null,
): Promise<ActionResult<BatchOutcome>> {
  const id = await insertOutcomeRow(
    supabase,
    conversationId,
    content,
    trace,
    agentId,
  );
  if (!id) return fail("Couldn't record the result.");
  return {
    ok: true,
    data: { messageId: id, content, trace, touchedBoardIds, agentId },
  };
}

/**
 * The apply path's outcome insert. By now the rows have RUN, so a failure
 * here must not read as "nothing happened": the card would reopen and a second
 * Apply would duplicate every create. Retry once; if it still fails, log it
 * and report success under a local id so the card locks and boards resync in
 * this session. The durable fix (claim the batch before running it) is
 * tracked for Plan B.
 */
async function insertAppliedOutcome(
  supabase: Supabase,
  conversationId: string,
  content: string,
  trace: AskToolTrace,
  touchedBoardIds: string[],
  agentId: string | null,
): Promise<ActionResult<BatchOutcome>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = await insertOutcomeRow(
      supabase,
      conversationId,
      content,
      trace,
      agentId,
    );
    if (id)
      return {
        ok: true,
        data: { messageId: id, content, trace, touchedBoardIds, agentId },
      };
  }
  console.error(
    `[assistant] applied batch outcome could not be recorded for ${conversationId}`,
  );
  return {
    ok: true,
    data: {
      messageId: `local-${crypto.randomUUID()}`,
      content,
      trace,
      touchedBoardIds,
      agentId,
    },
  };
}

const ORG_ROW_MISMATCH = "This change targets a different organization.";

/** Run one staged call under the user's own client. Never throws. */
async function runCall(
  supabase: Supabase,
  actorId: string,
  orgId: string,
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
  // Staging pinned every org-scoped call to the org it was staged in. Apply
  // runs it only in that same org, so a batch staged in org A cannot write
  // into org B after the user switches.
  if (takesOrgId(descriptor) && input.data.orgId !== orgId)
    return { id: call.id, ok: false, error: ORG_ROW_MISMATCH };
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
    console.error("[assistant] staged call threw", call.tool, e);
    return { id: call.id, ok: false, error: "Failed." };
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
      org.id,
      conversationId,
      messageId,
    );
    if (!loaded.ok) return fail(loaded.error);

    const selected = new Set(selectedIds);
    const results: StagedResult[] = [];
    const seen = new Set<string>();
    const touched = new Set<string>();
    for (const call of loaded.calls) {
      if (!selected.has(call.id) || seen.has(call.id)) {
        results.push({ id: call.id, ok: false, skipped: true });
        continue;
      }
      seen.add(call.id);
      const result = await runCall(supabase, user.id, org.id, call);
      results.push(result);
      if (result.ok && call.boardId) touched.add(call.boardId);
    }

    return await insertAppliedOutcome(
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
  } catch (e) {
    console.error("[assistant] applyBatch failed", e);
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
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");
    const supabase = await createClient();
    const loaded = await loadBatch(
      supabase,
      user.id,
      org.id,
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
  } catch (e) {
    console.error("[assistant] dismissBatch failed", e);
    return fail("Couldn't dismiss that. Please try again.");
  }
}
