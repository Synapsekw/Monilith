import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyBody } from "@/lib/ai/agentic/hmac";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { MODEL } from "@/lib/ai/providers/anthropic";
import { AiDisabledError, AiQuotaExceededError } from "@/lib/ai/errors";
import {
  getUserAgentById,
  findUserAgentRun,
  insertUserAgentRun,
} from "@/lib/agents/agents-db";
import { getAgentOwnerClient } from "@/lib/agents/owner-client";
import { buildBriefing } from "@/lib/agents/briefing";
import { summariseBriefing } from "@/lib/agents/summarise";
import { sendBriefingEmail } from "@/lib/agents/send";
import {
  assertRunAllowedToday,
  AgentCapExceededError,
} from "@/lib/agents/caps";

const FEATURE = "personal_agent_run";
const SIGNATURE_HEADER = "x-pulse-signature";

const bodySchema = z.object({
  agent_id: z.string().uuid(),
  fire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fire_hour: z.number().int().min(0).max(23),
});

/**
 * Personal-agent endpoint. The `personal-agent-sweep` cron
 * (`20260801094820_personal_agent_sweep.sql`) inserts a fire-ledger row
 * (once per agent per local slot) and fires a signed
 * `net.http_post { agent_id, fire_date, fire_hour }` here. This handler
 * (service-role, HMAC-verified) resolves an OWNER-SCOPED client, builds the
 * briefing under that owner's RLS, summarises it, emails it, and writes ONE
 * `user_agent_runs` audit row. Idempotent: a redelivered fire slot is a no-op,
 * which is what guarantees nobody gets two 07:00 emails.
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

  // 3. Idempotency: a fire slot that already has a run is a redelivery — no-op.
  const existing = await findUserAgentRun(svc, agentId, fireDate, fireHour);
  if (existing) {
    return NextResponse.json({ status: "noop", reason: "already_ran" });
  }

  const baseRun = {
    user_agent_id: agentId,
    org_id: agent.org_id,
    owner_id: agent.owner_id,
    fire_date: fireDate,
    fire_hour: fireHour,
  };

  try {
    // 4. Entitlement + per-user caps BEFORE any token spend.
    try {
      await requireAiEntitlement(agent.org_id, FEATURE);
      await assertRunAllowedToday(svc, agent.org_id, agent.owner_id, fireDate);
    } catch (e) {
      if (
        e instanceof AiDisabledError ||
        e instanceof AiQuotaExceededError ||
        e instanceof AgentCapExceededError
      ) {
        await insertUserAgentRun(svc, {
          ...baseRun,
          status: "skipped",
          error: e.message,
        });
        return NextResponse.json({ status: "skipped", reason: "gated" });
      }
      throw e;
    }

    // 5. Read AS THE OWNER. There is no service-client fallback here by design.
    const ownerClient = await getAgentOwnerClient(svc, agent);
    const briefing = await buildBriefing(
      ownerClient,
      agent.board_scope,
      fireDate,
    );

    // 6. Summarise (metered), then send.
    const result = await runAi(
      { orgId: agent.org_id, userId: agent.owner_id, feature: FEATURE },
      async ({ apiKey }) => {
        const r = await summariseBriefing({
          apiKey,
          instructions: agent.instructions,
          briefing,
        });
        return { result: r, usage: r.usage, model: MODEL };
      },
    );

    await sendBriefingEmail(svc, {
      agent,
      briefing,
      summary: result.summary,
    });

    // 7. Write the single audit row for this fire.
    await insertUserAgentRun(svc, {
      ...baseRun,
      status: "ran",
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
    });

    return NextResponse.json({ status: "ran" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    await insertUserAgentRun(svc, {
      ...baseRun,
      status: "error",
      error: message,
    });
    return NextResponse.json({ error: "agent run failed" }, { status: 500 });
  }
}
