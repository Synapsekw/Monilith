import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { hashToken } from "@/lib/mcp/oauth/crypto";
import type { RateLimitDecision } from "./auth-rate-limit";

const MCP_LIMIT = 120;
const MCP_WINDOW_SECONDS = 60;

/** Per-token fixed-window limit on /api/mcp, reusing the generic check_rate_limit RPC. */
export async function checkMcpRateLimit(
  accessToken: string,
): Promise<RateLimitDecision> {
  const supabase = createServiceClient();
  const { data, error } = await typedRpc(supabase, "check_rate_limit", {
    p_key: `mcp:token:${hashToken(accessToken)}`,
    p_limit: MCP_LIMIT,
    p_window_seconds: MCP_WINDOW_SECONDS,
  });
  if (error || !data?.[0]) return { allowed: true };
  const row = data[0];
  return row.allowed
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: row.retry_after };
}
