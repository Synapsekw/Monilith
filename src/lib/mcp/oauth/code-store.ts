import "server-only";
import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/types/database.types";

const CODE_TTL_SECONDS = 60;

export async function createAuthorizationCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
}): Promise<string> {
  const code = randomBytes(24).toString("base64url");
  const supabase = createServiceClient();
  const { error } = await supabase.from("oauth_codes").insert({
    code,
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return code;
}

export async function consumeAuthorizationCode(
  code: string,
): Promise<Tables<"oauth_codes"> | null> {
  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from("oauth_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (!row) return null;
  if (row.consumed_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  await supabase
    .from("oauth_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code", code);
  return row;
}
