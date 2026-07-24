import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
      p_secret: sessionData.session.refresh_token,
      p_name: `mcp_bridge:${userId}`,
    },
  );
  if (rpcErr || !secretId)
    throw new Error(rpcErr?.message ?? "Vault store failed.");
  return secretId;
}

/**
 * Refreshes the Supabase session stored behind `bridgeSecretId` and returns
 * a request-scoped client authenticated as that session's user. GoTrue
 * rotates refresh tokens on use, so the old Vault secret is replaced with
 * the new refresh token — callers MUST persist `newBridgeSecretId` back onto
 * the oauth_tokens row or the next request will fail.
 */
export async function getBridgedClient(
  bridgeSecretId: string,
): Promise<{ client: SupabaseClient<Database>; newBridgeSecretId: string }> {
  const svc = createServiceClient();
  const { data: refreshToken, error: getErr } = await typedRpc(
    svc,
    "oauth_bridge_get_secret",
    {
      p_secret_id: bridgeSecretId,
    },
  );
  if (getErr || !refreshToken)
    throw new Error(getErr?.message ?? "Bridge secret not found.");

  const anon = anonClient();
  const { data: refreshed, error: refreshErr } = await anon.auth.refreshSession(
    {
      refresh_token: refreshToken,
    },
  );
  if (refreshErr || !refreshed.session)
    throw new Error(refreshErr?.message ?? "Session refresh failed.");

  const { data: newSecretId, error: rotErr } = await typedRpc(
    svc,
    "oauth_bridge_rotate_secret",
    {
      p_old_secret_id: bridgeSecretId,
      p_secret: refreshed.session.refresh_token,
      p_name: `mcp_bridge:${refreshed.session.user.id}`,
    },
  );
  if (rotErr || !newSecretId)
    throw new Error(rotErr?.message ?? "Vault rotate failed.");

  const client = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${refreshed.session.access_token}` },
      },
    },
  );
  return { client, newBridgeSecretId: newSecretId };
}
