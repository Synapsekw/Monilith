import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/types/database.types";
import { generateOpaqueToken, hashToken } from "./crypto";

const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function issueTokenPair(input: {
  clientId: string;
  userId: string;
  bridgeSecretId: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const accessToken = generateOpaqueToken();
  const refreshToken = generateOpaqueToken();
  const supabase = createServiceClient();
  const now = Date.now();
  const { error } = await supabase.from("oauth_tokens").insert({
    client_id: input.clientId,
    user_id: input.userId,
    access_token_hash: hashToken(accessToken),
    refresh_token_hash: hashToken(refreshToken),
    bridge_secret_id: input.bridgeSecretId,
    access_token_expires_at: new Date(
      now + ACCESS_TOKEN_TTL_SECONDS * 1000,
    ).toISOString(),
    refresh_token_expires_at: new Date(
      now + REFRESH_TOKEN_TTL_SECONDS * 1000,
    ).toISOString(),
  });
  if (error) throw new Error(error.message);
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export async function lookupTokenByAccessToken(
  accessToken: string,
): Promise<Tables<"oauth_tokens"> | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("access_token_hash", hashToken(accessToken))
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.access_token_expires_at).getTime() < Date.now())
    return null;
  return data;
}

export async function lookupTokenByRefreshToken(
  refreshToken: string,
): Promise<Tables<"oauth_tokens"> | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("refresh_token_hash", hashToken(refreshToken))
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.refresh_token_expires_at).getTime() < Date.now())
    return null;
  return data;
}

/** Rotates an access/refresh pair for an existing row (reuses the same bridge secret). */
export async function rotateTokenPair(
  row: Tables<"oauth_tokens">,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const accessToken = generateOpaqueToken();
  const refreshToken = generateOpaqueToken();
  const supabase = createServiceClient();
  const now = Date.now();
  const { error } = await supabase
    .from("oauth_tokens")
    .update({
      access_token_hash: hashToken(accessToken),
      refresh_token_hash: hashToken(refreshToken),
      access_token_expires_at: new Date(
        now + ACCESS_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
      refresh_token_expires_at: new Date(
        now + REFRESH_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
    })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/** Persists a rotated bridge_secret_id after getBridgedClient() rotates the underlying Vault secret. */
export async function updateBridgeSecretId(
  tokenId: string,
  newBridgeSecretId: string,
): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from("oauth_tokens")
    .update({ bridge_secret_id: newBridgeSecretId })
    .eq("id", tokenId);
}
