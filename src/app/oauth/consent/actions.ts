"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { authorizeRequestSchema } from "@/lib/validations/mcp-oauth";
import { getOauthClient } from "@/lib/mcp/oauth/client-store";
import { createAuthorizationCode } from "@/lib/mcp/oauth/code-store";

export async function approveConsent(formData: FormData): Promise<void> {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = authorizeRequestSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid authorization request.");

  const client = await getOauthClient(parsed.data.client_id);
  if (!client || !client.redirect_uris.includes(parsed.data.redirect_uri)) {
    throw new Error("Unknown client or redirect_uri.");
  }

  const code = await createAuthorizationCode({
    clientId: parsed.data.client_id,
    userId: user.id,
    redirectUri: parsed.data.redirect_uri,
    codeChallenge: parsed.data.code_challenge,
  });

  const redirectUrl = new URL(parsed.data.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (parsed.data.state)
    redirectUrl.searchParams.set("state", parsed.data.state);
  redirect(redirectUrl.toString());
}
