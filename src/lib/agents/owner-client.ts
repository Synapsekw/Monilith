import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  mintBridgeSecret,
  getBridgedClient,
} from "@/lib/mcp/oauth/session-bridge";
import { setAgentBridgeSecret, type UserAgentRow } from "./agents-db";

/**
 * Resolve a personal agent to a Supabase client authenticated **as its owner**.
 *
 * This is the security crux of the feature. Every board read an agent performs
 * must be RLS-filtered to exactly what its owner can see — so the agent never
 * reads through the service client, and there is deliberately NO fallback path
 * that would let it. If the owner session cannot be established the run fails
 * closed and is recorded as an error.
 *
 * Reuses the MCP OAuth session bridge rather than a second impersonation
 * mechanism. The bridge secret is minted once per agent and cached on the row;
 * subsequent runs are a Vault read, and only a near-expiry access token costs a
 * GoTrue refresh. This matters operationally: `mintBridgeSecret` calls
 * `generateLink`, which GoTrue rate-limits, and at 07:00 every agent in an org
 * fires in the same hour.
 */
export async function getAgentOwnerClient(
  svc: SupabaseClient<Database>,
  agent: UserAgentRow,
): Promise<SupabaseClient<Database>> {
  let secretId = agent.bridge_secret_id;
  let justMinted = false;

  if (!secretId) {
    secretId = await mintBridgeSecret(agent.owner_id);
    justMinted = true;
  }

  const { client, newBridgeSecretId } = await getBridgedClient(secretId);

  // GoTrue rotates the refresh token on use, so a rotated id MUST be persisted
  // or the next run reads a dead secret and the bridge bricks.
  if (justMinted || newBridgeSecretId !== secretId) {
    await setAgentBridgeSecret(svc, agent.id, newBridgeSecretId);
  }

  return client;
}
