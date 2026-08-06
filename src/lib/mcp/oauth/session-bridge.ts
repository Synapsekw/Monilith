import "server-only";
import { randomUUID } from "node:crypto";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import type { Database } from "@/types/database.types";

function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * What's actually stored in the Vault secret behind bridge_secret_id: not
 * just the refresh token, but the *current* access token + its expiry, so
 * getBridgedClient() can serve most requests as a pure Vault read (no GoTrue
 * call, no secret rotation). Only refreshed once the cached access token is
 * actually near expiry — see getBridgedClient() below.
 */
type BridgeSecretPayload = {
  refreshToken: string;
  accessToken: string;
  /** Epoch ms. */
  accessExpiresAt: number;
};

/** A small buffer so we refresh slightly before GoTrue would reject the token. */
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000;

/**
 * The Vault secret name for a bridge, which MUST be unique per secret — never
 * per user.
 *
 * `vault.secrets.name` carries a UNIQUE index (`secrets_name_idx`) and
 * `oauth_bridge_rotate_secret` inserts through `vault.create_secret(p_secret,
 * p_name, …)`, so a name derived only from the user id lets the FIRST bridge a
 * user ever mints squat that name permanently. Every later mint for the same
 * user then died with
 *
 *   duplicate key value violates unique constraint "secrets_name_idx"
 *
 * surfacing as a bare HTTP 500 from POST /api/oauth/token — i.e. a user who had
 * connected one MCP client could never connect a second, and a user with a
 * personal agent (src/lib/agents/owner-client.ts mints through this same
 * function) could not connect an MCP client at all.
 *
 * Two clients must NOT share one bridge anyway: each holds its own GoTrue
 * session, and collapsing them onto one Vault row would make each client's
 * refresh rotate the other's token out from under it. So one secret per mint,
 * with the user id kept as a prefix purely so secrets stay greppable per user
 * during ops.
 */
function bridgeSecretName(userId: string): string {
  return `mcp_bridge:${userId}:${randomUUID()}`;
}

function payloadFromSession(session: Session): BridgeSecretPayload {
  const accessExpiresAt = session.expires_at
    ? session.expires_at * 1000
    : Date.now() + session.expires_in * 1000;
  return {
    refreshToken: session.refresh_token,
    accessToken: session.access_token,
    accessExpiresAt,
  };
}

/**
 * Mints a real GoTrue session for `userId` (via generateLink + verifyOtp —
 * no email is sent, this is a server-side impersonation primitive gated
 * entirely behind the service-role key) and stores its refresh token in
 * Vault. Returns the new bridge_secret_id to persist on the oauth_tokens row.
 */
export async function mintBridgeSecret(userId: string): Promise<string> {
  const svc = createServiceClient();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  const admin = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: userRes, error: userErr } =
    await admin.auth.admin.getUserById(userId);
  if (userErr || !userRes.user?.email)
    throw new Error(userErr?.message ?? "User has no email; cannot bridge.");

  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: userRes.user.email,
    });
  if (linkErr || !linkData)
    throw new Error(linkErr?.message ?? "generateLink failed.");

  const anon = anonClient();
  const { data: sessionData, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !sessionData.session)
    throw new Error(verifyErr?.message ?? "verifyOtp failed.");

  const { data: secretId, error: rpcErr } = await typedRpc(
    svc,
    "oauth_bridge_rotate_secret",
    {
      p_old_secret_id: null,
      p_secret: JSON.stringify(payloadFromSession(sessionData.session)),
      p_name: bridgeSecretName(userId),
    },
  );
  if (rpcErr || !secretId)
    throw new Error(rpcErr?.message ?? "Vault store failed.");
  return secretId;
}

function clientFromAccessToken(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    },
  );
}

/**
 * Resolves the Supabase session stored behind `bridgeSecretId` to a
 * request-scoped client authenticated as that session's user.
 *
 * The Vault secret caches the last-minted access token alongside its
 * expiry, so the common case (access token still valid) is a pure Vault
 * read — no GoTrue call, no secret rotation, no DB write. This matters
 * because MCP clients routinely dispatch multiple tool calls concurrently
 * on one connection: if every call refreshed the session, two concurrent
 * calls would race to consume the same single-use refresh token, and
 * GoTrue's reuse-detection can revoke the whole session family and brick
 * the bridge. Only refresh when the cached access token is actually
 * expired (or within `ACCESS_TOKEN_REFRESH_BUFFER_MS` of expiring) — that
 * still rotates the refresh token (GoTrue does this unconditionally on
 * use) and the old Vault secret, so callers MUST persist
 * `newBridgeSecretId` back onto the oauth_tokens row; when nothing
 * rotated, `newBridgeSecretId` is the same id and that persist becomes a
 * harmless no-op write.
 */
export async function getBridgedClient(
  bridgeSecretId: string,
): Promise<{ client: SupabaseClient<Database>; newBridgeSecretId: string }> {
  const svc = createServiceClient();
  const { data: secretJson, error: getErr } = await typedRpc(
    svc,
    "oauth_bridge_get_secret",
    {
      p_secret_id: bridgeSecretId,
    },
  );
  if (getErr || !secretJson)
    throw new Error(getErr?.message ?? "Bridge secret not found.");

  const cached = JSON.parse(secretJson) as BridgeSecretPayload;

  if (Date.now() < cached.accessExpiresAt - ACCESS_TOKEN_REFRESH_BUFFER_MS) {
    return {
      client: clientFromAccessToken(cached.accessToken),
      newBridgeSecretId: bridgeSecretId,
    };
  }

  const anon = anonClient();
  const { data: refreshed, error: refreshErr } = await anon.auth.refreshSession(
    {
      refresh_token: cached.refreshToken,
    },
  );
  if (refreshErr || !refreshed.session)
    throw new Error(refreshErr?.message ?? "Session refresh failed.");

  const { data: newSecretId, error: rotErr } = await typedRpc(
    svc,
    "oauth_bridge_rotate_secret",
    {
      p_old_secret_id: bridgeSecretId,
      p_secret: JSON.stringify(payloadFromSession(refreshed.session)),
      // A fresh unique name, not the old one: the rpc DELETEs p_old_secret_id
      // before inserting, but that only frees THIS bridge's name — a sibling
      // bridge for the same user still holds its own row, so a per-user name
      // would collide here exactly as it did on mint.
      p_name: bridgeSecretName(refreshed.session.user.id),
    },
  );
  if (rotErr || !newSecretId)
    throw new Error(rotErr?.message ?? "Vault rotate failed.");

  return {
    client: clientFromAccessToken(refreshed.session.access_token),
    newBridgeSecretId: newSecretId,
  };
}
