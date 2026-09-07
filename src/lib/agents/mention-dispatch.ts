import "server-only";
import { after } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { signBody } from "@/lib/ai/agentic/hmac";

/**
 * Fire the already-claimed run, without making the commenter wait for it.
 *
 * The CLAIM is the durable part and it has already happened, so a dispatch that
 * never lands leaves a row that `agentRunDisplayStatus` renders "In progress"
 * and then, after STALE_CLAIM_MS, "Didn't finish" — a state the run history was
 * built to display. That is why this may be best-effort: the alternative, doing
 * the run inside the Server Action, would block the user's comment for a minute.
 *
 * WHY THE `fetch` IS AWAITED INSIDE `after`. `after` keeps the calling function
 * alive until its callback settles, and the personal-agent route answers only
 * when the whole run is done (`maxDuration = 300`). So the caller can time out
 * waiting — and that is harmless, which is the property to preserve: the reply
 * is posted by the CALLEE, from its own invocation, so a caller that is torn
 * down after the request was delivered loses nothing but its own idle time.
 * Not awaiting at all is the option that actually breaks: an un-awaited fetch
 * in a serverless function can be killed before the bytes are flushed.
 */
export async function dispatchAgentRun(
  runId: string,
  itemId: string,
  updateId: string,
): Promise<void> {
  const secret = getServerEnv().AI_PGNET_HMAC_SECRET;
  const base = getServerEnv().APP_BASE_URL;
  if (!secret || !base) {
    console.error("[agents] mention dispatch not provisioned", {
      runId,
      hasSecret: !!secret,
      hasBase: !!base,
    });
    return;
  }
  // `item_id` and `update_id` ride the SIGNED body, so the route learns which
  // item summoned the run and which comment said it WITHOUT a column on
  // `user_agent_runs` for values only this one trigger has. Both are covered by
  // the HMAC like every other field, so neither can be swapped in transit for
  // an item or a comment the summoner could not see.
  const body = JSON.stringify({
    run_id: runId,
    item_id: itemId,
    update_id: updateId,
  });
  const send = async (): Promise<void> => {
    try {
      await fetch(`${base}/api/ai/personal-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Pulse-Signature": signBody(body, secret),
        },
        body,
      });
    } catch (e) {
      console.error("[agents] mention dispatch failed:", {
        runId,
        cause: String(e),
      });
    }
  };
  try {
    after(send);
  } catch {
    // No request scope — a direct call in a unit test. Still run it, detached.
    // Same shape as `settings-actions.ts`'s `after(verifyIds)`.
    void send();
  }
}
