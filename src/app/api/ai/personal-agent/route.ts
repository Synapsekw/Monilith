import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getServerEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyBody } from "@/lib/ai/agentic/hmac";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { readOrgAiSettings } from "@/lib/ai/org-settings";
import { languageModelFor } from "@/lib/ai/providers/language-model";
import {
  AiDisabledError,
  AiQuotaExceededError,
  PersonalAiKeyMissingError,
  ByoKeyMissingError,
} from "@/lib/ai/errors";
import { getUserAgentById, findUserAgentRun } from "@/lib/agents/agents-db";
import { getAgentOwnerClient } from "@/lib/agents/owner-client";
import {
  buildAgentRuntime,
  runAgentLoop,
  ModelNotToolCapableError,
} from "@/lib/agents/run-loop";
import { AGENT_ONLY_DESCRIPTORS } from "@/lib/agents/agent-only-tools";
import type { ProposedCall } from "@/lib/agents/grant-gate";
import type { AgentCapability } from "@/lib/agents/capabilities";
import { insertProposals } from "@/lib/agents/proposals-db";
import { summariseProposal } from "@/lib/agents/proposal-summary";
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

const FEATURE = "personal_agent_run";
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

  // ── Hoisted above the try so the CATCH can see them ────────────────────
  // A run that dies at step 5 still did whatever steps 1–4 did: granted writes
  // that really landed on the owner's boards, and denied calls the model was
  // already told were "Recorded for your approval." All of that used to be
  // discarded with the rejected promise, leaving `user_agent_runs` unable to
  // answer "what did my agent do to my boards" for the one run where the
  // question matters most.
  const proposals: ProposedCall[] = [];
  let effectiveGrants: AgentCapability[] = [];
  // High-water marks, updated by `runAgentLoop`'s onStep after every completed
  // step — the last values before a throw are what that run actually achieved.
  let loopSteps = 0;
  let loopToolsUsed: string[] = [];

  /**
   * Persist the run's proposals, at most once.
   *
   * The flag is set BEFORE the await on purpose. The owner's ruling is that a
   * FAILING insert fails the whole run loudly (it throws, the outer catch
   * records "error", no email) — so a retry from that catch would be pointless
   * and would mask the original error. What the flag does NOT cover, and what
   * this function exists for, is never REACHING the insert: a provider 5xx or
   * timeout mid-loop used to drop every proposal on the floor while the model
   * had already told the owner they were recorded.
   */
  let proposalsPersisted = false;
  const persistProposals = async (): Promise<void> => {
    if (proposalsPersisted) return;
    proposalsPersisted = true;
    await insertProposals(
      svc,
      proposals.map((p) => ({
        userAgentId: agent.id,
        runId: claim.runId,
        orgId: agent.org_id,
        ownerId: agent.owner_id,
        capability: p.capability,
        toolName: p.toolName,
        toolCallId: p.toolCallId,
        input: p.input,
        // SERVER-derived, never model text — the security property the column's
        // own comment states. `summariseProposal` builds its sentence from the
        // tool input alone, so what the owner approves is a description of what
        // will actually execute. It never throws: a bad shape degrades to
        // `Run <tool>.` rather than failing the whole batch insert.
        summary: summariseProposal(p.toolName, p.input),
      })),
    );
  };

  try {
    // 5. Entitlement + per-user caps BEFORE any token spend.
    try {
      await requireAiEntitlement(agent.org_id, FEATURE);
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
    // it in place (no push/sort/splice); `.filter` below copies.
    const { agentCapabilityCeiling } = await readOrgAiSettings(
      svc,
      agent.org_id,
    );
    effectiveGrants = agent.capabilities.filter((c) =>
      agentCapabilityCeiling.includes(c),
    );

    // 7. Run the bounded tool loop (metered). Two states are CONFIGURATION
    //    states, not faults, and are caught separately from the generic error
    //    path below so they land in `user_agent_runs` as "skipped" with a
    //    clear reason:
    //      - PersonalAiKeyMissingError: the owner has no per_user key on file.
    //      - ByoKeyMissingError: the org's org_byo mode has no vault secret.
    //    A third — ModelNotToolCapableError — is raised INSIDE the callback
    //    (only there is the resolved model known) and handled the same way:
    //    the agent's pinned model, or the org default, cannot call tools, so
    //    there is no loop to run. The old ProviderNotCapableError guard is
    //    GONE with it: this loop is provider-agnostic (the AI SDK drives it
    //    through whichever adapter the key resolved to), so the honest
    //    question is no longer "is this Anthropic?" but "can THIS model call
    //    tools?", which `ai_models.supports_tools` answers per model.
    //    Deliberately NOT caught here: a plain (non-Personal) AiNotConfiguredError
    //    — e.g. `managed` mode's platform ANTHROPIC_API_KEY missing — is an
    //    OPERATIONAL fault (nobody but ops can fix it, and it silently kills
    //    every briefing in the org every day), so it falls through to the
    //    generic catch below and is recorded as "error", not "skipped".
    let result: Awaited<ReturnType<typeof runAgentLoop>>;
    // Written to the run row below. `user_agent_runs.model_substituted` exists
    // precisely so "your pinned model is gone, this ran on the default" is its
    // own signal instead of being overloaded onto `error` — a substituted run
    // still SUCCEEDED, and recording it as an error would tell the owner their
    // agent is broken when it is not.
    let modelSubstituted = false;
    try {
      result = await runAi(
        {
          orgId: agent.org_id,
          userId: agent.owner_id,
          feature: FEATURE,
          // The per-agent pin. Null on either means "org default", which is
          // exactly what runAi does when they are omitted.
          provider: agent.provider ?? undefined,
          requestedModel: agent.model_id,
        },
        async ({ adapter, apiKey, baseUrl, model }, reportUsage) => {
          if (!model.supportsTools)
            throw new ModelNotToolCapableError(model.model);
          modelSubstituted = model.substituted;

          // ONE call assembles BOTH halves. `buildAgentTools` and
          // `makeGrantGate` are each a pure function of the same descriptor
          // list, and building them separately is exactly how a tool once
          // ended up executable but unclassified — see buildAgentRuntime.
          const { tools, gate } = buildAgentRuntime({
            ctx: {
              getClient: async () => ownerClient,
              actorId: agent.owner_id,
            },
            scope: agent.board_scope,
            client: ownerClient,
            extra: AGENT_ONLY_DESCRIPTORS,
            granted: effectiveGrants,
            ceiling: agentCapabilityCeiling,
            // Collected, not written through per call: `insertProposals` is
            // one bounded insert for the whole run, and the run is the unit
            // that either produced these or died trying. The error path
            // persists them too — see `persistProposals`.
            onPropose: (call) => proposals.push(call),
          });

          const r = await runAgentLoop({
            // The WIRE id, never the catalog key the pin stores: the Gateway
            // publishes `claude-haiku-4.5` where Anthropic's API wants the
            // dated snapshot, and sending the key is a 404.
            model: languageModelFor({
              kind: adapter.kind,
              apiKey,
              baseUrl,
              model: model.requestModel,
            }),
            instructions: agent.instructions,
            tools,
            gate,
            // No per-run output ceiling: the loop is bounded by
            // AGENT_MAX_STEPS, and a token cap that truncates mid-report
            // emails a half-sentence. The seam stays for when the catalog's
            // per-model `max_output_tokens` is threaded through.
            maxOutputTokens: null,
            // The audit trail for a run that dies mid-loop. Without this, a
            // throw at step 5 discards everything steps 1–4 did — including
            // the tokens those steps really spent, which `reportUsage` hands
            // to `runAi` so its catch can still write the ledger row. Steps
            // 1–11 of a run that dies at step 12 are real, billed provider
            // round-trips; metering only on success spends managed-mode money
            // against no ledger row and under-counts the monthly ceiling.
            onStep: ({ steps, toolsUsed, usage }) => {
              loopSteps = steps;
              loopToolsUsed = toolsUsed;
              reportUsage(usage);
            },
          });
          return { result: r, usage: r.usage };
        },
      );
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

    // 8. Persist what the agent asked permission for. BEFORE the email, so the
    //    "N actions await your approval" line can never name rows that do not
    //    exist yet. `insertProposals` stamps `status` and `expires_at`
    //    (now + PROPOSAL_TTL_DAYS) itself — no caller can queue a proposal
    //    that is born approved or born immortal. A failure here throws, by
    //    design: it lands in the catch below as a loud "error" run rather than
    //    an email promising approvals that were never queued.
    await persistProposals();

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
      proposalCount: proposals.length,
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
      model_substituted: modelSubstituted,
      grants: effectiveGrants,
      steps: result.steps,
      tools_used: result.toolsUsed,
      output: result.text,
    });

    return NextResponse.json({ status: "ran" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";

    // The model was told "Recorded for your approval." before this run died,
    // and may have said so to the owner in text that is now lost. Queueing the
    // proposals anyway keeps that promise: the owner finds them under the
    // failed run and can still approve them. BEST EFFORT here and only here —
    // we are already on the failure path, so a second failure must be logged
    // rather than thrown, or it would replace the real cause of the run's
    // death with a bookkeeping error. (No-op when the success path already
    // persisted them, including when THAT insert is what threw.)
    try {
      await persistProposals();
    } catch (pe) {
      console.error("[personal-agent] proposal persist on error path failed:", {
        agentId: key.user_agent_id,
        runId: claim.runId,
        proposals: proposals.length,
        cause: pe instanceof Error ? pe.message : String(pe),
      });
    }

    // The partial audit trail. A run that wrote to three boards and then threw
    // must not record silence — `grants` says what it was permitted to do,
    // `steps`/`tools_used` what it got through before it died. `output` is
    // deliberately absent: there is no report, and inventing one would be
    // worse than the empty column.
    await safeFinalize(svc, key, {
      status: "error",
      error: message,
      grants: effectiveGrants,
      steps: loopSteps,
      tools_used: loopToolsUsed,
    });
    return NextResponse.json({ error: "agent run failed" }, { status: 500 });
  }
}
