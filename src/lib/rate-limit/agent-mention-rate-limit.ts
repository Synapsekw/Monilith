import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import type { RateLimitDecision } from "./auth-rate-limit";

/** Summons per user per hour. Ten is generous for a person having a
 *  conversation with their own agent on an item and hostile to a script. */
export const AGENT_MENTION_LIMIT = 10;
export const AGENT_MENTION_WINDOW_SECONDS = 3600;

/**
 * Per-USER fixed-window limit on summoning an agent with an `@handle`, reusing
 * the generic `check_rate_limit` RPC.
 *
 * Fails OPEN, and the reason matters: the fail-CLOSED layer is
 * `agent_run_claim` — the 5-minute mention cooldown and the org's daily cap
 * both live inside the RPC, under a row lock. This limiter exists to stop a
 * scripted flood from reaching the RPC at all, and a rate-limit table outage
 * must not stop people from commenting. Note what "open" costs here: nothing
 * more than the cooldown and the cap already permit, because those two are
 * evaluated afterwards regardless of what this returns.
 *
 * Keyed on the AUTHOR, not the agent: an owner with ten agents summoning each
 * of them in turn is the flood this bounds, and a per-agent key would let it
 * through ten times over.
 */
export async function checkAgentMentionRateLimit(
  userId: string,
): Promise<RateLimitDecision> {
  const supabase = createServiceClient();
  try {
    const { data, error } = await typedRpc(supabase, "check_rate_limit", {
      p_key: `agent-mention:user:${userId}`,
      p_limit: AGENT_MENTION_LIMIT,
      p_window_seconds: AGENT_MENTION_WINDOW_SECONDS,
    });
    if (error || !data?.[0]) return { allowed: true };
    const row = data[0];
    return row.allowed
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds: row.retry_after };
  } catch (err) {
    console.error("[agent-mention-rate-limit] fail-open: threw", { err });
    // fail open
    return { allowed: true };
  }
}
