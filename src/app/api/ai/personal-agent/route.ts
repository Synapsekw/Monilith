import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getServerEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyBody } from "@/lib/ai/agentic/hmac";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { MODEL } from "@/lib/ai/providers/anthropic";
import {
  AiDisabledError,
  AiQuotaExceededError,
  PersonalAiKeyMissingError,
  ByoKeyMissingError,
  ProviderNotCapableError,
} from "@/lib/ai/errors";
import { getUserAgentById, findUserAgentRun } from "@/lib/agents/agents-db";
import { getAgentOwnerClient } from "@/lib/agents/owner-client";
import { buildBriefing } from "@/lib/agents/briefing";
import {
  summariseBriefing,
  type BriefingSummary,
} from "@/lib/agents/summarise";
import { sendBriefingEmail } from "@/lib/agents/send";
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
): Promise<"claimed" | "already_claimed"> {
  const { error } = await svc.from("user_agent_runs").insert({
    user_agent_id: key.user_agent_id,
    org_id: key.org_id,
    owner_id: key.owner_id,
    fire_date: key.fire_date,
    fire_hour: key.fire_hour,
    status: "error",
    error: CLAIM_PLACEHOLDER,
  });
  if (!error) return "claimed";
  if (error.code === PG_UNIQUE_VIOLATION) return "already_claimed";
  throw new Error(`claimRun: ${error.message}`);
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
 * (service-role, HMAC-verified) resolves an OWNER-SCOPED client, builds the
 * briefing under that owner's RLS, summarises it, emails it, and writes ONE
 * `user_agent_runs` audit row. Idempotent: a redelivered fire slot is a
 * no-op — see `claimRun` for why that holds even under concurrent delivery,
 * not just sequential redelivery.
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
  let claim: "claimed" | "already_claimed";
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
  if (claim === "already_claimed") {
    // Another delivery of this exact fire slot already won the claim — do
    // nothing further. This is the case a redelivery landing concurrently
    // with an in-flight run relies on: no second summarise call, no second
    // email.
    return NextResponse.json({ status: "noop", reason: "already_ran" });
  }

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
    const ownerClient = await getAgentOwnerClient(svc, agent);
    const briefing = await buildBriefing(
      ownerClient,
      agent.board_scope,
      fireDate,
    );

    // 7. Summarise (metered), then send. Three distinct states are
    //    CONFIGURATION states, not faults, and are caught separately from the
    //    generic error path below so they land in `user_agent_runs` as
    //    "skipped" with a clear reason:
    //      - PersonalAiKeyMissingError: the owner has no per_user key on file.
    //      - ByoKeyMissingError: the org's org_byo mode has no vault secret.
    //      - ProviderNotCapableError: the owner's resolved key IS present but
    //        is for a non-Anthropic provider (per_user mode allows OpenAI/
    //        Gemini keys, and summariseBriefing hard-codes the Anthropic SDK
    //        — see summarise.ts). Without this guard, a wrong-provider key
    //        gets POSTed to api.anthropic.com, 401s, and silently kills the
    //        agent every day as an opaque "error" row with no way for the
    //        owner to learn why. Detected INSIDE the runAi callback (only
    //        there is `adapter` available) and thrown before summariseBriefing
    //        is ever called, so nothing is spent.
    //    Deliberately NOT caught here: a plain (non-Personal) AiNotConfiguredError
    //    — e.g. `managed` mode's platform ANTHROPIC_API_KEY missing — is an
    //    OPERATIONAL fault (nobody but ops can fix it, and it silently kills
    //    every briefing in the org every day), so it falls through to the
    //    generic catch below and is recorded as "error", not "skipped".
    let result: BriefingSummary;
    try {
      result = await runAi(
        { orgId: agent.org_id, userId: agent.owner_id, feature: FEATURE },
        async ({ adapter, apiKey }) => {
          if (adapter.id !== "anthropic") {
            throw new ProviderNotCapableError(FEATURE);
          }
          const r = await summariseBriefing({
            apiKey,
            instructions: agent.instructions,
            briefing,
          });
          return { result: r, usage: r.usage, model: MODEL };
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
      if (e instanceof ProviderNotCapableError) {
        await safeFinalize(svc, key, {
          status: "skipped",
          error:
            "Personal agents currently require an Anthropic key. The owner's " +
            "configured AI provider (Settings → AI) is not Anthropic, so " +
            "this run was skipped rather than billed to the wrong provider.",
        });
        return NextResponse.json({
          status: "skipped",
          reason: "wrong_provider",
        });
      }
      throw e;
    }

    await sendBriefingEmail(svc, {
      agent,
      briefing,
      summary: result.summary,
    });

    // 8. Finalize the single audit row for this fire (Finding 2: never let
    //    a bookkeeping-write failure crash a response whose real outcome —
    //    the email — already succeeded).
    await safeFinalize(svc, key, {
      status: "ran",
      error: null,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
    });

    return NextResponse.json({ status: "ran" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    await safeFinalize(svc, key, { status: "error", error: message });
    return NextResponse.json({ error: "agent run failed" }, { status: 500 });
  }
}
