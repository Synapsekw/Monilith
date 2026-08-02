import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  mintBridgeSecret,
  getBridgedClient,
} from "@/lib/mcp/oauth/session-bridge";
import { setAgentBridgeSecret, type UserAgentRow } from "./agents-db";

/**
 * `getBridgedClient` (session-bridge.ts) throws a plain `Error` with no
 * discriminated code — this is the one message that means "the stored
 * secret id has no row in `vault.decrypted_secrets`", from
 * `oauth_bridge_get_secret`'s scalar `select ... where id = p_secret_id`
 * returning NULL rather than raising (see 20260724133321_mcp_oauth.sql).
 * Message-matching is the most precise signal available without changing
 * session-bridge.ts, which this task must not touch.
 */
const BRIDGE_SECRET_NOT_FOUND_MESSAGE = "Bridge secret not found.";

function isBridgeSecretNotFound(err: unknown): boolean {
  return (
    err instanceof Error && err.message === BRIDGE_SECRET_NOT_FOUND_MESSAGE
  );
}

type BridgedResult = Awaited<ReturnType<typeof getBridgedClient>>;

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

  let bridged: BridgedResult;
  try {
    bridged = await getBridgedClient(secretId);
  } catch (err) {
    // A secret can go missing if a prior rotation's persist below failed, or
    // the process died between rotate and persist: oauth_bridge_rotate_secret
    // deletes the OLD vault row before returning the new id, so once that
    // delete has happened the stale id left on the row is gone for good —
    // and because bridge_secret_id is non-null, the `!secretId` re-mint
    // above never fires again on its own. Treat exactly this failure as a
    // re-mint trigger so the agent self-heals instead of requiring manual DB
    // surgery. Re-minting is still owner-scoped (`mintBridgeSecret` takes
    // `agent.owner_id`), so this is not a privilege fallback. Any other
    // failure (network, GoTrue down, refresh rejected) still propagates and
    // fails closed.
    if (!isBridgeSecretNotFound(err)) throw err;
    secretId = await mintBridgeSecret(agent.owner_id);
    justMinted = true;
    bridged = await getBridgedClient(secretId);
  }

  const { client, newBridgeSecretId } = bridged;

  // Owner-scope invariant: this module's entire purpose is that the returned
  // client is authenticated as agent.owner_id. That has held so far only
  // because this module is the sole writer of bridge_secret_id — confirm it
  // explicitly rather than trust that implicitly, so a re-parented owner or
  // a mis-assigned secret id fails loudly instead of silently returning a
  // client scoped to the wrong person. Checked BEFORE persisting below, so a
  // failed invariant never gets written into the row. auth.getUser() round
  // -trips to GoTrue — this client carries only a bearer header and no local
  // session, so there is nothing to validate without a network call — one
  // extra request per invocation, accepted here because correctness on the
  // security-critical path outweighs it.
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData.user || userData.user.id !== agent.owner_id) {
    throw new Error(
      `Owner-scope invariant violated for agent ${agent.id}: bridged client resolved to ${userData.user?.id ?? "unknown"}, expected owner ${agent.owner_id}.`,
    );
  }

  // GoTrue rotates the refresh token on use, so a rotated id MUST be persisted
  // or the next run reads a dead secret and the bridge bricks.
  if (justMinted || newBridgeSecretId !== secretId) {
    await setAgentBridgeSecret(svc, agent.id, newBridgeSecretId);
  }

  return client;
}
