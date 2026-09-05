import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getServerEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyBody } from "@/lib/ai/agentic/hmac";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { readOrgAiSettings } from "@/lib/ai/org-settings";
import {
  AiDisabledError,
  AiQuotaExceededError,
  PersonalAiKeyMissingError,
  ByoKeyMissingError,
} from "@/lib/ai/errors";
import { getUserAgentById, findUserAgentRun } from "@/lib/agents/agents-db";
import { getAgentOwnerClient } from "@/lib/agents/owner-client";
import { ModelNotToolCapableError } from "@/lib/agents/run-loop";
// The per-run work — budget, tools, bounded loop, proposals — lives in
// `execute-run.ts` so a delegated child run executes the identical path this
// route does. What stays HERE is everything that is about the FIRE rather than
// the run: the claim, the entitlement and per-user caps, the owner client, the
// org ceiling read, the thread, the email, and the single audit row.
import {
  executeAgentRun,
  newRunProgress,
  AGENT_RUN_FEATURE,
  type ExecuteRunResult,
} from "@/lib/agents/execute-run";
import { sendBriefingEmail } from "@/lib/agents/send";
import { writeBriefingThread } from "@/lib/agents/briefing-thread";
import {
  assertRunAllowedToday,
  AgentCapExceededError,
} from "@/lib/agents/caps";
/** Conservative placeholder on the claim row: if the process dies before
 *  `finalizeRun` runs, the audit trail correctly reads "did not complete"
 *  rather than falsely "ran". `status` has no fourth ("pending"/"claimed")
 *  value available — the check constraint is `in ('ran','skipped','error')`
 *  and adding one is a migration — so this reuses 'error', the only one of
 *  the three that is truthful before the outcome is known. Defined in
 *  `run-status.ts` because the run-history UI has to recognise it and NOT
 *  render it as a hard failure; the two must never drift apart. */
import { CLAIM_PLACEHOLDER } from "@/lib/agents/run-status";

const SIGNATURE_HEADER = "x-pulse-signature";
/** Postgres unique_violation — raised by `user_agent_runs_slot_uniq`. */
const PG_UNIQUE_VIOLATION = "23505";

const bodySchema = z.object({
  agent_id: z.string().uuid(),
  fire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fire_hour: z.number().int().min(0).max(23),
});

type RunKey = {
  user_agent_id: string;
  org_id: string;
  owner_id: string;
  fire_date: string;
  fire_hour: number;
};

/**
 * Claim the (user_agent_id, fire_date, fire_hour) slot BEFORE any token
 * spend or email. This insert — not the `findUserAgentRun` probe in POST
 * below — is the ACTUAL idempotency backstop: two concurrent deliveries of
 * the same fire slot both see `findUserAgentRun → null` (that probe is only
 * a fast path and can race), but only one of them can win this insert
 * against `user_agent_runs_slot_uniq`. The loser gets a 23505 and does
 * nothing further — no summarise call, no email. The winner proceeds and
 * later overwrites this placeholder row via `finalizeRun`.
 */
async function claimRun(
  svc: SupabaseClient<Database>,
  key: RunKey,
): Promise<
  { outcome: "claimed"; runId: string } | { outcome: "already_claimed" }
> {
  const { data, error } = await svc
    .from("user_agent_runs")
    .insert({
      user_agent_id: key.user_agent_id,
      org_id: key.org_id,
      owner_id: key.owner_id,
      fire_date: key.fire_date,
      fire_hour: key.fire_hour,
      status: "error",
      error: CLAIM_PLACEHOLDER,
    })
    .select("id")
    .single();
  if (!error && data) return { outcome: "claimed", runId: data.id };
  if (error?.code === PG_UNIQUE_VIOLATION)
    return { outcome: "already_claimed" };
  throw new Error(`claimRun: ${error?.message ?? "no row returned"}`);
}

/** Update the already-claimed row to its final status. Keyed on the same
 *  (user_agent_id, fire_date, fire_hour) slot the claim insert used — an
 *  UPDATE can never itself hit the unique index, so there is nothing left to
 *  arbitrate here; a failure is an ordinary write failure, not a race. */
async function finalizeRun(
  svc: SupabaseClient<Database>,
  key: RunKey,
  patch: {
    status: "ran" | "skipped" | "error";
    error?: string | null;
    input_tokens?: number | null;
    output_tokens?: number | null;
    /** True when the agent's pinned model was unavailable and runAi fell back. */
    model_substituted?: boolean;
    /** True when a non-empty document set did not fit the model's context and
     *  was dropped in its entirety — see `selectDocuments` (all-or-nothing). */
    documents_omitted?: boolean;
    /** How many memory notes did not fit. A COUNT, not a boolean: memory
     *  truncation is PARTIAL by design — see `selectMemory`. */
    memory_notes_dropped?: number;
    /** What the run was EFFECTIVELY permitted to do — the agent's own grants
     *  intersected with the org ceiling, as it stood at run time. */
    grants?: string[];
    /** Model round-trips consumed, out of AGENT_MAX_STEPS. */
    steps?: number;
    /** The tools that actually EXECUTED (denied calls are not "used"). */
    tools_used?: string[];
    /** The agent's own report — the same text the email and thread carry. */
    output?: string | null;
  },
): Promise<void> {
  const { error } = await svc
    .from("user_agent_runs")
    .update(patch)
    .eq("user_agent_id", key.user_agent_id)
    .eq("fire_date", key.fire_date)
    .eq("fire_hour", key.fire_hour);
  if (error) throw new Error(`finalizeRun: ${error.message}`);
}

/**
 * By the time this is called the slot is already claimed (the fire ledger
 * has consumed it) and the real outcome — email sent, correctly gated, or
 * genuinely errored — has already happened. A failure writing THAT outcome
 * down must never crash the response or mask the real result, so it is
 * logged rather than thrown.
 */
async function safeFinalize(
  svc: SupabaseClient<Database>,
  key: RunKey,
  patch: Parameters<typeof finalizeRun>[2],
): Promise<void> {
  try {
    await finalizeRun(svc, key, patch);
  } catch (e) {
    console.error("[personal-agent] finalizeRun failed:", {
      agentId: key.user_agent_id,
      fireDate: key.fire_date,
      fireHour: key.fire_hour,
      patchStatus: patch.status,
      cause: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Personal-agent endpoint. The `personal-agent-sweep` cron
 * (`20260801094820_personal_agent_sweep.sql`) inserts a fire-ledger row
 * (once per agent per local slot) and fires a signed
 * `net.http_post { agent_id, fire_date, fire_hour }` here. This handler
 * (service-role, HMAC-verified) resolves an OWNER-SCOPED client, runs a
 * BOUNDED TOOL LOOP under that owner's RLS, queues anything the agent had no
 * grant for as a proposal, emails the agent's report, and writes ONE
 * `user_agent_runs` audit row. Idempotent: a redelivered fire slot is a
 * no-op — see `claimRun` for why that holds even under concurrent delivery,
 * not just sequential redelivery.
 *
 * The loop replaced a fixed briefing pipeline (build a payload → one
 * tool-less summarise call → email). Everything OUTSIDE the model call is
 * unchanged and deliberately so: the claim, the entitlement and per-user caps,
 * the owner-client resolution, the safe finalize, and the config-state error
 * taxonomy were all load-bearing before and remain so.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = getServerEnv().AI_PGNET_HMAC_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not provisioned" }, { status: 503 });
  }

  // 1. HMAC-verify the raw body BEFORE parsing (the signature covers the bytes).
  const raw = await req.text();
  const sig = req.headers.get(SIGNATURE_HEADER) ?? "";
  if (!sig || !verifyBody(raw, sig, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let agentId: string;
  let fireDate: string;
  let fireHour: number;
  try {
    const parsed = bodySchema.parse(JSON.parse(raw));
    agentId = parsed.agent_id;
    fireDate = parsed.fire_date;
    fireHour = parsed.fire_hour;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const svc = createServiceClient();

  // 2. Load the agent.
  const agent = await getUserAgentById(svc, agentId);
  if (!agent) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Kill switch: a disabled agent does nothing (no run row, no spend).
  if (!agent.enabled) {
    return NextResponse.json({ status: "skipped", reason: "disabled" });
  }

  // 3. Fast-path idempotency probe. This is an optimisation ONLY — it can
  //    race under concurrent delivery of the same fire slot (two deliveries
  //    can both observe `null` here). claimRun below is what actually
  //    arbitrates; this just avoids the extra round trip on the
  //    overwhelmingly common case of a plain sequential redelivery.
  const existing = await findUserAgentRun(svc, agentId, fireDate, fireHour);
  if (existing) {
    return NextResponse.json({ status: "noop", reason: "already_ran" });
  }

  const key: RunKey = {
    user_agent_id: agentId,
    org_id: agent.org_id,
    owner_id: agent.owner_id,
    fire_date: fireDate,
    fire_hour: fireHour,
  };

  // 4. Claim the slot BEFORE any token spend or email (Finding 1).
  let claim: Awaited<ReturnType<typeof claimRun>>;
  try {
    claim = await claimRun(svc, key);
  } catch (e) {
    // The claim attempt itself failed for a reason OTHER than a conflict
    // (e.g. a transient DB error). Nothing was spent and nothing else was
    // written, so it's safe to just fail closed — there is no row to
    // finalize.
    console.error("[personal-agent] claimRun failed:", {
      agentId,
      fireDate,
      fireHour,
      cause: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "agent run failed" }, { status: 500 });
  }
  if (claim.outcome === "already_claimed") {
    // Another delivery of this exact fire slot already won the claim — do
    // nothing further. This is the case a redelivery landing concurrently
    // with an in-flight run relies on: no second summarise call, no second
    // email.
    return NextResponse.json({ status: "noop", reason: "already_ran" });
  }

  // ── Hoisted above the try so the CATCH can see it ──────────────────────
  // A run that dies at step 5 still did whatever steps 1–4 did: granted writes
  // that really landed on the owner's boards, and denied calls the model was
  // already told were "Recorded for your approval." All of that used to be
  // discarded with the rejected promise, leaving `user_agent_runs` unable to
  // answer "what did my agent do to my boards" for the one run where the
  // question matters most. `executeAgentRun` mutates this as it goes, so the
  // catch below reads the high-water marks of a run that never returned.
  const progress = newRunProgress();

  try {
    // 5. Entitlement + per-user caps BEFORE any token spend.
    try {
      await requireAiEntitlement(agent.org_id, AGENT_RUN_FEATURE);
      await assertRunAllowedToday(svc, agent.org_id, agent.owner_id, fireDate);
    } catch (e) {
      if (
        e instanceof AiDisabledError ||
        e instanceof AiQuotaExceededError ||
        e instanceof AgentCapExceededError
      ) {
        await safeFinalize(svc, key, { status: "skipped", error: e.message });
        return NextResponse.json({ status: "skipped", reason: "gated" });
      }
      throw e;
    }

    // 6. Read AS THE OWNER. There is no service-client fallback here by design.
    //    Everything the agent sees and does this run goes through this client,
    //    so the owner's RLS remains the real boundary.
    const ownerClient = await getAgentOwnerClient(svc, agent);

    // The ADMIN half of the two-key gate. Read at RUN time, not at write time:
    // an admin who lowers the ceiling clamps every existing agent at once,
    // without anyone editing them. `agentCapabilityCeiling` may be the module
    // singleton `DEFAULT_ORG_AI_SETTINGS` returns by identity — never mutate
    // it in place (no push/sort/splice); `executeAgentRun` only `.filter`s it.
    const { agentCapabilityCeiling } = await readOrgAiSettings(
      svc,
      agent.org_id,
    );

    // 7. Run the bounded tool loop (metered). Two states are CONFIGURATION
    //    states, not faults, and are caught separately from the generic error
    //    path below so they land in `user_agent_runs` as "skipped" with a
    //    clear reason:
    //      - PersonalAiKeyMissingError: the owner has no per_user key on file.
    //      - ByoKeyMissingError: the org's org_byo mode has no vault secret.
    //    A third — ModelNotToolCapableError — is raised INSIDE `runAi`'s
    //    callback (only there is the resolved model known) and handled the
    //    same way: the agent's pinned model, or the org default, cannot call
    //    tools, so there is no loop to run. The old ProviderNotCapableError
    //    guard is GONE with it: this loop is provider-agnostic (the AI SDK
    //    drives it through whichever adapter the key resolved to), so the
    //    honest question is no longer "is this Anthropic?" but "can THIS model
    //    call tools?", which `ai_models.supports_tools` answers per model.
    //    Deliberately NOT caught here: a plain (non-Personal)
    //    AiNotConfiguredError — e.g. `managed` mode's platform
    //    ANTHROPIC_API_KEY missing — is an OPERATIONAL fault (nobody but ops
    //    can fix it, and it silently kills every briefing in the org every
    //    day), so it falls through to the generic catch below and is recorded
    //    as "error", not "skipped".
    let result: ExecuteRunResult;
    try {
      result = await executeAgentRun({
        svc,
        ownerClient,
        agent,
        runId: claim.runId,
        ceiling: agentCapabilityCeiling,
        // A scheduled fire is the ROOT of its (currently one-node) run tree.
        // Task 5 flips this to true, once there is a `delegate` tool for it to
        // offer; until then no call site can hand the model one.
        allowDelegation: false,
        progress,
      });
    } catch (e) {
      if (
        e instanceof PersonalAiKeyMissingError ||
        e instanceof ByoKeyMissingError
      ) {
        await safeFinalize(svc, key, {
          status: "skipped",
          error: `AI not configured for this run (${e.message})`,
        });
        return NextResponse.json({ status: "skipped", reason: "no_key" });
      }
      if (e instanceof ModelNotToolCapableError) {
        // A configuration state the OWNER can fix, so it is recorded as
        // "skipped" with a message naming the model and both places a model
        // can come from. Nothing was spent — the throw happens before the
        // first model call.
        await safeFinalize(svc, key, { status: "skipped", error: e.message });
        return NextResponse.json({
          status: "skipped",
          reason: "model_not_tool_capable",
        });
      }
      throw e;
    }

    // 8. The proposals are already queued — `executeAgentRun` persists them
    //    BEFORE returning, so the "N actions await your approval" line below
    //    can never name rows that do not exist yet, and a failed insert has
    //    already failed the run loudly rather than emailing a promise it did
    //    not keep.
    //
    // Thread BEFORE email, so the email can link to it. Never gates the run: a
    // failed write returns null and the email simply omits the link.
    const threadId = await writeBriefingThread(ownerClient, {
      orgId: agent.org_id,
      ownerId: agent.owner_id,
      agentId: agent.id,
      agentName: agent.name,
      runId: claim.runId,
      fireDate,
      summary: result.text,
    });

    await sendBriefingEmail(svc, {
      agent,
      fireDate,
      summary: result.text,
      proposalCount: result.proposalCount,
      threadId,
    });

    // 9. Finalize the single audit row for this fire (Finding 2: never let
    //    a bookkeeping-write failure crash a response whose real outcome —
    //    the email — already succeeded).
    await safeFinalize(svc, key, {
      status: "ran",
      error: null,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      model_substituted: progress.modelSubstituted,
      // Straight off the loop's own result, not a local mirror of it. Same
      // rationale as `modelSubstituted`: a run whose documents did not fit
      // still SUCCEEDED — `documents_omitted` is its own signal, never folded
      // into `error`. `runAgentLoop` echoes the flag back precisely so the
      // caller persists what the loop actually ran with.
      documents_omitted: result.documentsOmitted,
      // Same posture as documents_omitted and model_substituted: a run whose
      // memory was truncated SUCCEEDED. A count, because "12 of your 50 notes
      // didn't fit" is actionable and "memory omitted" is not.
      memory_notes_dropped: result.memoryNotesDropped,
      grants: progress.grants,
      steps: result.steps,
      tools_used: result.toolsUsed,
      output: result.text,
    });

    return NextResponse.json({ status: "ran" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";

    // Proposals are NOT queued here: `executeAgentRun` owns that on both of
    // its paths — it persists them before returning, and best-effort persists
    // them (logging, never throwing, on a second failure) when the loop dies
    // mid-run. A run that died AFTER it returned therefore has them already.

    // The partial audit trail. A run that wrote to three boards and then threw
    // must not record silence — `grants` says what it was permitted to do,
    // `steps`/`tools_used` what it got through before it died. `output` is
    // deliberately absent: there is no report, and inventing one would be
    // worse than the empty column.
    await safeFinalize(svc, key, {
      status: "error",
      error: message,
      grants: progress.grants,
      steps: progress.steps,
      tools_used: progress.toolsUsed,
    });
    return NextResponse.json({ error: "agent run failed" }, { status: 500 });
  }
}
