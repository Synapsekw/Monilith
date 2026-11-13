"use server";
import * as z from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { parseToolTrace, type AskToolTrace } from "@/lib/ai/ask/tool-trace";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database.types";
import { getMonoClient } from "@/lib/mono/session";
import { loadOwnedMono } from "@/lib/monos/turn";
import { findDescriptor } from "./catalog";
import { takesOrgId } from "./org-pin";
import { unsupportedReason } from "./unsupported";
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
};

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Loaded =
  | { ok: true; calls: StagedCall[]; monoId: string | null }
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
    .select("user_id, org_id, mono_id")
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
    .select("tool_trace")
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

  return { ok: true, calls, monoId: conv.data.mono_id ?? null };
}

type InsertedRow = { id: string | null; error: unknown };

/** Insert the outcome turn. `id` is null when the insert failed; `error` says why. */
async function insertOutcomeRow(
  supabase: Supabase,
  conversationId: string,
  content: string,
  trace: AskToolTrace,
): Promise<InsertedRow> {
  const ins = await supabase
    .from("ai_messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content,
      tool_trace: trace as unknown as Json,
    })
    .select("id")
    .single();
  return ins.error || !ins.data
    ? { id: null, error: ins.error }
    : { id: ins.data.id, error: null };
}

async function insertOutcome(
  supabase: Supabase,
  conversationId: string,
  content: string,
  trace: AskToolTrace,
  touchedBoardIds: string[],
): Promise<ActionResult<BatchOutcome>> {
  const { id } = await insertOutcomeRow(
    supabase,
    conversationId,
    content,
    trace,
  );
  if (!id) return fail("Couldn't record the result.");
  return {
    ok: true,
    data: { messageId: id, content, trace, touchedBoardIds },
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
): Promise<ActionResult<BatchOutcome>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { id, error } = await insertOutcomeRow(
      supabase,
      conversationId,
      content,
      trace,
    );
    if (id)
      return {
        ok: true,
        data: { messageId: id, content, trace, touchedBoardIds },
      };
    lastError = error;
  }
  console.error(
    `[assistant] applied batch outcome could not be recorded for ${conversationId}`,
    lastError,
  );
  return {
    ok: true,
    data: {
      messageId: `local-${crypto.randomUUID()}`,
      content,
      trace,
      touchedBoardIds,
    },
  };
}

const ORG_ROW_MISMATCH = "This change targets a different organization.";

/** Run one staged call under the acting client (the user's own, or on a Mono
 *  thread the Mono's own session). Never throws. */
async function runCall(
  supabase: SupabaseClient<Database>,
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
  // Authoritative: refuses even a row that was stored before the rule existed.
  const refusal = unsupportedReason(call.tool, call.input);
  if (refusal) return { id: call.id, ok: false, error: refusal };
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

/**
 * The outcome turn's content is what the user sees AND what the model reads on
 * every later turn, so it says plainly what the user decided and what ran.
 * `ASSISTANT_PREAMBLE` names these opening lines as the system's record.
 */
const APPLIED_OUTCOME_HEAD = "You confirmed these changes.";
const DISMISSED_OUTCOME = "You dismissed these changes. Nothing was changed.";

function outcomeLine(call: StagedCall, result: StagedResult): string {
  if (result.skipped)
    return `Not applied (you left it unticked): ${call.summary}`;
  return result.ok
    ? `Applied: ${call.summary}`
    : `Failed: ${call.summary} (${result.error ?? "Failed."})`;
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

    // A Mono thread applies as the Mono, so RLS judges its own board
    // memberships and the rows show the Mono as their author. The outcome
    // turn is still written by the owner, who owns the thread.
    let actingClient: SupabaseClient<Database> = supabase;
    let actorId = user.id;
    if (loaded.monoId) {
      const mono = await loadOwnedMono(
        supabase,
        user.id,
        org.id,
        loaded.monoId,
      );
      if (!mono) return fail("Conversation not found.");
      actingClient = await getMonoClient(mono.userId);
      actorId = mono.userId;
    }

    const selected = new Set(selectedIds);
    if (!loaded.calls.some((c) => selected.has(c.id)))
      return fail("Pick at least one change to apply.");
    const results: StagedResult[] = [];
    const seen = new Set<string>();
    const touched = new Set<string>();
    for (const call of loaded.calls) {
      if (!selected.has(call.id) || seen.has(call.id)) {
        results.push({ id: call.id, ok: false, skipped: true });
        continue;
      }
      seen.add(call.id);
      const result = await runCall(actingClient, actorId, org.id, call);
      results.push(result);
      if (result.ok && call.boardId) touched.add(call.boardId);
    }

    return await insertAppliedOutcome(
      supabase,
      conversationId,
      [
        APPLIED_OUTCOME_HEAD,
        ...loaded.calls.map((c, i) => outcomeLine(c, results[i]!)),
      ].join("\n"),
      {
        resolvesProposal: messageId,
        outcome: "applied",
        stagedResults: results,
      },
      [...touched],
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
      DISMISSED_OUTCOME,
      { resolvesProposal: messageId, outcome: "cancelled" },
      [],
    );
  } catch (e) {
    console.error("[assistant] dismissBatch failed", e);
    return fail("Couldn't dismiss that. Please try again.");
  }
}
