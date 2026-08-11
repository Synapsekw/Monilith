import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { verifyBody } from "@/lib/ai/agentic/hmac";
import { buildJobContext } from "@/lib/ai/agentic/context";
import { decideAction } from "@/lib/ai/agentic/decide";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { AiDisabledError, AiQuotaExceededError } from "@/lib/ai/errors";
import { automationActionSchema } from "@/lib/validations/automations";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { AutomationAction } from "@/lib/validations/automations";

const FEATURE = "automation_ai_step";
const bodySchema = z.object({ job_id: z.string().uuid() });

/**
 * Hand the chosen action (or null → "skipped") to the CONFINED definer. This is
 * the ONLY write path: `automation_ai_apply` re-applies the same per-action
 * confinement guards as `_automation_run`, writes the `automation_runs` outcome,
 * and marks the job done/skipped.
 *
 * This call used to hand-narrow `svc.rpc` because the RPC arrived in the same
 * task's migration and was not yet in the generated union. It has been in
 * database.types.ts since that migration was applied, so the cast is gone and
 * the function name, args and return type are checked again.
 */
async function applyConfined(
  svc: SupabaseClient<Database>,
  jobId: string,
  action: AutomationAction | null,
): Promise<void> {
  const { error } = await typedRpc(svc, "automation_ai_apply", {
    p_job: jobId,
    p_action: action,
  });
  if (error) throw new Error(`automation_ai_apply failed: ${error.message}`);
}

/**
 * F13 async-hop endpoint (spec §4.2). `_automation_run` inserts an
 * `automation_ai_jobs` row and fires a signed `net.http_post {job_id}` here.
 * This handler (service-role, HMAC-verified) decides ONE bounded action via the
 * gateway and applies it ONLY through the confined definer. Idempotent: a
 * redelivered call on a non-`pending` job is a no-op. Entitlement `off`/quota
 * short-circuits to a logged `ai_skipped` with NO token spend.
 */
export async function POST(req: Request): Promise<Response> {
  const env = getServerEnv();
  if (!env.AI_PGNET_HMAC_SECRET) {
    return NextResponse.json({ error: "not provisioned" }, { status: 503 });
  }

  // 1. HMAC-verify the raw body BEFORE parsing (the signature covers the bytes).
  const raw = await req.text();
  const sig = req.headers.get("x-pulse-signature") ?? "";
  if (!sig || !verifyBody(raw, sig, env.AI_PGNET_HMAC_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let jobId: string;
  try {
    jobId = bodySchema.parse(JSON.parse(raw)).job_id;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const svc = createServiceClient();

  // 2. Load the job (all DB work scoped to its own org_id/board_id).
  const { data: job } = await svc
    .from("automation_ai_jobs")
    .select("id, automation_id, org_id, board_id, item_id, config, status")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Idempotency: only a pending job is actionable (redelivery is a no-op).
  if (job.status !== "pending") {
    return NextResponse.json({ status: "noop", reason: job.status });
  }

  // The job config IS the ai_step action authored on the rule.
  const cfg = automationActionSchema.safeParse(job.config);
  if (!cfg.success || cfg.data.type !== "ai_step") {
    await applyConfined(svc, jobId, null);
    return NextResponse.json({ status: "skipped", reason: "bad_config" });
  }
  const { instruction, allow } = cfg.data;

  try {
    // 3. Entitlement gate BEFORE any token spend. off/quota ⇒ logged ai_skipped.
    try {
      await requireAiEntitlement(job.org_id, FEATURE);
    } catch (e) {
      if (e instanceof AiDisabledError || e instanceof AiQuotaExceededError) {
        await applyConfined(svc, jobId, null);
        return NextResponse.json({ status: "skipped", reason: "entitlement" });
      }
      throw e;
    }

    // 4. Build the labels+ids context and decide ONE action (metered via runAi).
    const context = await buildJobContext(svc, {
      orgId: job.org_id,
      boardId: job.board_id,
      itemId: job.item_id,
    });
    const { data: rule } = await svc
      .from("automations")
      .select("created_by")
      .eq("id", job.automation_id)
      .maybeSingle();

    const decision = await runAi(
      {
        orgId: job.org_id,
        userId: rule?.created_by ?? job.org_id,
        feature: FEATURE,
      },
      async ({ apiKey, model }) => {
        const r = await decideAction({
          apiKey,
          model: model.requestModel,
          context,
          instruction,
          allow,
        });
        return { result: r, usage: r.usage };
      },
    );

    // 5. Apply ONLY via the confined definer (null ⇒ logged ai_skipped).
    await applyConfined(svc, jobId, decision.action);
    return NextResponse.json({
      status: decision.action ? "decided" : "skipped",
      warnings: decision.warnings,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    await svc
      .from("automation_ai_jobs")
      .update({
        status: "error",
        error: message,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return NextResponse.json({ error: "step failed" }, { status: 500 });
  }
}
