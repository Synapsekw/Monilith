import "server-only";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { lookupTokenByAccessToken } from "@/lib/mcp/oauth/token-store";
import { getBridgedClient, healBridge } from "@/lib/mcp/oauth/session-bridge";
import { BridgeSessionDeadError } from "@/lib/mcp/oauth/bridge-errors";
import { checkMcpRateLimit } from "@/lib/rate-limit/mcp-rate-limit";

/** withMcpAuth's verifyToken callback. Resolves our opaque bearer token to a user. */
export async function resolveMcpAuth(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const row = await lookupTokenByAccessToken(bearerToken);
  if (!row) return undefined;
  return {
    token: bearerToken,
    clientId: row.client_id,
    scopes: [],
    extra: {
      userId: row.user_id,
      tokenRowId: row.id,
      bridgeSecretId: row.bridge_secret_id,
    },
  };
}

/**
 * The authenticated MCP user's id — the `actor_id` for any side effect a tool
 * performs on their behalf (e.g. the `assigned` notification fan-out in
 * `upsertCellCore`). `resolveMcpAuth` always stamps it, so absence is a
 * programming error, not a runtime condition: throw, exactly as
 * `getRequestClient` does for its sibling `extra` fields.
 *
 * It must match the subject of the bridged access token, otherwise the
 * `notifications` insert policy (`actor_id = auth.uid()`) rejects the row —
 * a fail-closed outcome, never a cross-tenant write.
 */
export function mcpActorId(auth: AuthInfo): string {
  const userId = auth.extra?.userId;
  if (typeof userId !== "string" || !userId)
    throw new Error("Malformed auth context.");
  return userId;
}

/**
 * Per-tool-call: enforces the rate limit, then resolves the RLS-respecting
 * bridged client for the authenticated MCP connection. Every tool handler
 * calls this first and runs its Supabase calls through the returned client
 * — never the service-role client.
 */
export async function getRequestClient(
  auth: AuthInfo,
): Promise<SupabaseClient<Database>> {
  const decision = await checkMcpRateLimit(auth.token);
  if (!decision.allowed) {
    throw new Error(
      `Rate limited — retry after ${decision.retryAfterSeconds}s.`,
    );
  }
  const bridgeSecretId = auth.extra?.bridgeSecretId as string | undefined;
  const tokenRowId = auth.extra?.tokenRowId as string | undefined;
  if (!bridgeSecretId || !tokenRowId)
    throw new Error("Malformed auth context.");

  try {
    // Passing the token row id makes any secret rotation a compare-and-set on
    // that row, done inside the call — nothing to persist afterwards.
    return (await getBridgedClient(bridgeSecretId, tokenRowId)).client;
  } catch (error) {
    // Heal ONLY on positive proof that the stored Supabase session is gone
    // (GoTrue said the refresh token or session no longer exists, or the Vault
    // secret is missing). The MCP token itself was verified to get here, so the
    // user's grant stands and a fresh session for the same user is the right
    // repair. Everything else — a network error, a GoTrue 5xx or 429, a Vault
    // RPC failure, an unreadable payload — is NOT proof: it propagates as a
    // retryable failure and the stored state is left alone. Catching all errors
    // here used to turn every transient outage into one new session per tool
    // call. Disconnecting an app deletes its oauth_tokens row, so a revoked
    // connection never reaches this point.
    if (!(error instanceof BridgeSessionDeadError)) throw error;
    const healed = await healBridge({
      tokenRowId,
      userId: mcpActorId(auth),
      deadSecretId: bridgeSecretId,
    });
    return healed.client;
  }
}
