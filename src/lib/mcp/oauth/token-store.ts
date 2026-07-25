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

/**
 * Atomically validates and rotates a refresh token in a single round trip.
 *
 * The lookup (matching refresh_token_hash + client_id + revoked_at is null) and the
 * rotation (writing new hashes) happen as one conditional UPDATE, so two concurrent
 * requests presenting the same refresh token cannot both succeed: only the first
 * caller's UPDATE matches a row (its WHERE clause is keyed on the pre-rotation hash),
 * and once that row's hash changes, a racing second caller's UPDATE matches nothing
 * and `.maybeSingle()` returns null. This mirrors `consumeAuthorizationCode` in
 * `code-store.ts`, which closes the same TOCTOU race for authorization codes.
 */
export async function rotateTokenPair(
  refreshToken: string,
  clientId: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} | null> {
  const supabase = createServiceClient();
  const now = Date.now();
  const newAccessToken = generateOpaqueToken();
  const newRefreshToken = generateOpaqueToken();
  const { data, error } = await supabase
    .from("oauth_tokens")
    .update({
      access_token_hash: hashToken(newAccessToken),
      refresh_token_hash: hashToken(newRefreshToken),
      access_token_expires_at: new Date(
        now + ACCESS_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
      refresh_token_expires_at: new Date(
        now + REFRESH_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
    })
    .eq("refresh_token_hash", hashToken(refreshToken))
    .eq("client_id", clientId)
    .is("revoked_at", null)
    .select("id, refresh_token_expires_at")
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.refresh_token_expires_at).getTime() < Date.now())
    return null;
  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
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
