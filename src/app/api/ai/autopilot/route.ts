import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyBody } from "@/lib/ai/agentic/hmac";
import { buildAgentContext } from "@/lib/ai/agentic/context";
import { autopilotRun } from "@/lib/ai/agentic/autopilot";
import { runAi } from "@/lib/ai/gateway";
import { assertToolLoopCapable } from "@/lib/ai/tool-capability";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { readOrgAiSettings } from "@/lib/ai/org-settings";
import { AiDisabledError, AiQuotaExceededError } from "@/lib/ai/errors";
import { boardAgentConfigSchema } from "@/lib/ai/agentic/autopilot-config";
import {
  getBoardAgentById,
  findBoardAgentRun,
  insertBoardAgentRun,
  getPlatformAgentUserId,
  applyBoardAgentAction,
  type BoardAgentRunInsert,
} from "@/lib/ai/agentic/board-agents-db";

const FEATURE = "autopilot_run";
const SIGNATURE_HEADER = "x-pulse-signature";
// (fire_date, fire_hour) is the org-local fire slot from the sweep — the
// idempotency key. `daily` agents fire once (at run_at_local_hour); `hourly`
// agents fire each hour, so the hour is part of the key.
const bodySchema = z.object({
  agent_id: z.string().uuid(),
  fire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fire_hour: z.number().int().min(0).max(23),
});

/**
 * F14 Autopilot endpoint (spec §4.3). The `autopilot-sweep` cron inserts a
 * `board_agent_fires` row (once per agent per local day) and fires a signed
 * `net.http_post { agent_id, fire_date }` here. This handler (service-role,
 * HMAC-verified) reads the board, lets the bounded agent loop choose a small set
 * of reversible housekeeping actions, and applies each ONLY through the confined
 * `board_agent_apply` definer — which authors comments/notifications as the
 * platform bot (`platform_agent_user_id()`). Every run writes ONE
 * `board_agent_runs` audit row. Idempotent: a redelivered call for a fire_date
 * that already has a run is a no-op. Entitlement `off`/quota short-circuits to a
 * logged `skipped` run with NO token spend. Kill switch = `enabled = false`.
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

  // 2. Load the agent (all DB work scoped to its own org_id/board_id).
  const agent = await getBoardAgentById(svc, agentId);
  if (!agent) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Kill switch: a disabled agent does nothing (no run row, no spend).
  if (!agent.enabled) {
    return NextResponse.json({ status: "skipped", reason: "disabled" });
  }

  // 3. Idempotency: a fire slot that already has a run is a redelivery — no-op.
  const existing = await findBoardAgentRun(svc, agentId, fireDate, fireHour);
  if (existing) {
    return NextResponse.json({ status: "noop", reason: "already_ran" });
  }

  const baseRun: Pick<
    BoardAgentRunInsert,
    "board_agent_id" | "org_id" | "board_id" | "fire_date" | "fire_hour"
  > = {
    board_agent_id: agentId,
    org_id: agent.org_id,
    board_id: agent.board_id,
    fire_date: fireDate,
    fire_hour: fireHour,
  };

  try {
    // 4. Entitlement gate BEFORE any token spend. off/quota ⇒ logged skipped run.
    try {
      await requireAiEntitlement(agent.org_id, FEATURE);
    } catch (e) {
      if (e instanceof AiDisabledError || e instanceof AiQuotaExceededError) {
        await insertBoardAgentRun(svc, {
          ...baseRun,
          status: "skipped",
          actions: [],
          warnings: [{ reason: "entitlement", detail: e.message }],
        });
        return NextResponse.json({ status: "skipped", reason: "entitlement" });
      }
      throw e;
    }

    // 5. Build the labels+ids board context; decide the housekeeping set (metered).
    const context = await buildAgentContext(svc, {
      orgId: agent.org_id,
      boardId: agent.board_id,
    });
    const tasks = boardAgentConfigSchema.parse(agent.config).tasks;
    // Truthful attribution: usage + authorship belong to the platform bot —
    // and the bot goes by whatever THIS org calls it. One bounded read on the
    // org's own settings row (primary key), on a cron path that already reads
    // the entitlement, so the prompt cannot introduce the agent as something
    // other than the name its comments are signed with.
    const botUserId =
      (await getPlatformAgentUserId(svc)) ?? agent.created_by ?? agent.org_id;
    const { assistantName } = await readOrgAiSettings(svc, agent.org_id);

    const decision = await runAi(
      { orgId: agent.org_id, userId: botUserId, feature: FEATURE },
      async ({ provider, apiKey, model }) => {
        // The loop below builds `new Anthropic({ apiKey })` directly and
        // ignores baseUrl, so it physically cannot run on another provider.
        // Refuse at the boundary rather than POSTing someone else's key to
        // api.anthropic.com — per_user mode resolves the ORG DEFAULT provider
        // when an agent pins none.
        assertToolLoopCapable(provider, FEATURE);
        const r = await autopilotRun({
          apiKey,
          model: model.requestModel,
          agentContext: context,
          tasks,
          assistantName,
        });
        return { result: r, usage: r.usage };
      },
    );

    // 6. Apply EACH chosen action ONLY via the confined definer; collect outcomes.
    const outcomes: {
      item_id: string;
      type: string;
      outcome: string;
    }[] = [];
    for (const chosen of decision.actions) {
      const outcome = await applyBoardAgentAction(svc, {
        agentId,
        itemId: chosen.itemId,
        action: chosen.action,
      });
      outcomes.push({
        item_id: chosen.itemId,
        type: chosen.action.type,
        outcome,
      });
    }

    // 7. Write the single audit row for this fire.
    await insertBoardAgentRun(svc, {
      ...baseRun,
      status: "ran",
      actions: outcomes,
      warnings: decision.warnings,
      input_tokens: decision.usage.inputTokens,
      output_tokens: decision.usage.outputTokens,
    });

    return NextResponse.json({
      status: "ran",
      applied: outcomes.length,
      warnings: decision.warnings,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    await insertBoardAgentRun(svc, {
      ...baseRun,
      status: "error",
      error: message,
    });
    return NextResponse.json({ error: "autopilot failed" }, { status: 500 });
  }
}
