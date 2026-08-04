"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { executeAction } from "@/lib/ai/write/execute";
import type { ValidatedAction, ExecutionResult } from "@/lib/ai/write/schema";
// Type-only: this is a `"use server"` module, where a non-async export fails
// only at `pnpm build`. BoardEffect lives in a plain module both sides import.
import type { BoardEffect } from "@/lib/ai/write/effects";
import { parseToolTrace, type AskToolTrace } from "./tool-trace";
// Canonical shared result type — never re-declare locally (AGENTS.md invariant).
import { fail, type ActionResult } from "@/lib/actions/result";
import type { Json } from "@/types/database.types";

const idsSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});

/** The appended outcome turn, handed straight back so the client can push it
 *  into the transcript without a refetch (0 RSC navigations). `effects` is
 *  TRANSIENT — it is deliberately absent from `trace`, which is persisted into
 *  ai_messages.tool_trace and read back on every thread open. Rows in there
 *  would bloat the thread and replay STALE state onto the board later. */
export type ProposalOutcome = {
  messageId: string;
  content: string;
  trace: AskToolTrace;
  effects: BoardEffect[];
};

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type Loaded =
  | { ok: true; actions: ValidatedAction[] }
  | { ok: false; error: string };

/**
 * Read a proposal turn back through RLS and refuse anything already resolved.
 *
 * The CLIENT NEVER SENDS THE ACTIONS — it sends two ids, and the payload is
 * re-read from a row the caller could only reach via their own RLS scope. That
 * is strictly stronger than round-tripping a ValidatedAction[] through the
 * browser. `parseToolTrace` is the re-validation: the column is untyped jsonb,
 * so every action goes back through `validatedActionSchema` (and its ≤10 cap)
 * before we will run it.
 */
async function loadProposal(
  supabase: SupabaseClient,
  conversationId: string,
  messageId: string,
): Promise<Loaded> {
  const row = await supabase
    .from("ai_messages")
    .select("tool_trace")
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (row.error || !row.data)
    return { ok: false, error: "Proposal not found." };

  const actions = parseToolTrace(row.data.tool_trace)?.proposedActions ?? [];
  if (actions.length === 0)
    return { ok: false, error: "That turn has nothing to apply." };

  // Idempotency: two tabs, or a double click, must not double-write. Scoped by
  // the indexed conversation_id over a thread already capped at 200 rows.
  const prior = await supabase
    .from("ai_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("tool_trace->>resolvesProposal", messageId)
    .limit(1);
  if (prior.data?.length)
    return { ok: false, error: "This proposal was already resolved." };

  return { ok: true, actions };
}

/**
 * Append the outcome as a real assistant turn rather than updating the proposal
 * row. Two independent reasons: `ai_messages` has no UPDATE policy (RLS
 * default-deny, and this is user-owned content so the service client is the
 * wrong tool), and `buildAskMessages` feeds the model `content` only — an
 * outcome hidden in jsonb would leave the model believing nothing happened.
 */
async function insertOutcome(
  supabase: SupabaseClient,
  conversationId: string,
  content: string,
  trace: AskToolTrace,
  effects: BoardEffect[],
): Promise<ActionResult<ProposalOutcome>> {
  const ins = await supabase
    .from("ai_messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content,
      // The generated column type is the opaque `Json`; the shape is guaranteed
      // by askToolTraceSchema, so this cast is a serialization detail, not a
      // loosening of types. `effects` is NOT part of it, by design.
      tool_trace: trace as unknown as Json,
    })
    .select("id")
    .single();
  if (ins.error || !ins.data) return fail("Couldn't record the result.");
  return {
    ok: true,
    data: { messageId: ins.data.id, content, trace, effects },
  };
}

/** Deterministic outcome copy — no extra model call, no extra tokens. */
function outcomeContent(
  actions: ValidatedAction[],
  results: ExecutionResult[],
): string {
  return actions
    .map((a, i) => {
      const r = results[i];
      if (!r) return `Failed — ${a.summary}: no result.`;
      return r.ok
        ? `Done — ${a.summary}.`
        : `Failed — ${a.summary}: ${r.error}`;
    })
    .join("\n");
}

/**
 * Apply a proposal the user approved in the /ask thread.
 *
 * No `runAi` and no new charge: executing an approved proposal is deterministic
 * DB work, not a model call (mirrors `executeActions`). We only re-check that
 * the org can still use AI, so a stale proposal can't be applied after an admin
 * turns AI off. RLS is the guard on every underlying write.
 */
export async function applyAskProposal(input: {
  conversationId: string;
  messageId: string;
}): Promise<ActionResult<ProposalOutcome>> {
  const parsed = idsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid proposal.");
  const { conversationId, messageId } = parsed.data;

  try {
    await requireUser();
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");
    const ent = await getAiEntitlement(org.id);
    if (ent.mode === "off")
      return fail("AI is turned off for your organization.");

    const supabase = await createClient();
    const loaded = await loadProposal(supabase, conversationId, messageId);
    if (!loaded.ok) return fail(loaded.error);

    // `results` is persisted in the trace; `effects` are the rows the writes
    // produced, returned transiently so the client can render them with NO
    // extra round-trip. Bounded by parseToolTrace's ≤10 action cap.
    const results: ExecutionResult[] = [];
    const effects: BoardEffect[] = [];
    for (const action of loaded.actions) {
      const { result, effect } = await executeAction(action);
      results.push(result);
      if (effect) effects.push(effect);
    }

    return await insertOutcome(
      supabase,
      conversationId,
      outcomeContent(loaded.actions, results),
      { resolvesProposal: messageId, outcome: "applied", results },
      effects,
    );
  } catch {
    return fail("Couldn't apply that action. Please try again.");
  }
}

/**
 * Decline a proposal. Persisted (not just dismissed client-side) for two
 * reasons: the card must not come back pending after a reload, and the model
 * has to learn the user declined instead of re-proposing the same thing.
 * No entitlement check — nothing is spent and nothing is written.
 */
export async function cancelAskProposal(input: {
  conversationId: string;
  messageId: string;
}): Promise<ActionResult<ProposalOutcome>> {
  const parsed = idsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid proposal.");
  const { conversationId, messageId } = parsed.data;

  try {
    await requireUser();
    const supabase = await createClient();
    const loaded = await loadProposal(supabase, conversationId, messageId);
    if (!loaded.ok) return fail(loaded.error);

    return await insertOutcome(
      supabase,
      conversationId,
      "Cancelled — nothing was changed.",
      { resolvesProposal: messageId, outcome: "cancelled" },
      // A cancel changes nothing, so it carries no effects.
      [],
    );
  } catch {
    return fail("Couldn't cancel that. Please try again.");
  }
}
