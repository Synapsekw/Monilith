import "server-only";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { lookupTokenByAccessToken } from "@/lib/mcp/oauth/token-store";
import { getBridgedClient } from "@/lib/mcp/oauth/session-bridge";
import { updateBridgeSecretId } from "@/lib/mcp/oauth/token-store";
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

  const { client, newBridgeSecretId } = await getBridgedClient(bridgeSecretId);
  await updateBridgeSecretId(tokenRowId, newBridgeSecretId);
  return client;
}
