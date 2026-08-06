"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { authorizeRequestSchema } from "@/lib/validations/mcp-oauth";
import { getOauthClient } from "@/lib/mcp/oauth/client-store";
import { createAuthorizationCode } from "@/lib/mcp/oauth/code-store";
import { isRegisteredRedirectUri } from "@/lib/mcp/oauth/redirect-uri";

export async function approveConsent(formData: FormData): Promise<void> {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = authorizeRequestSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid authorization request.");

  const client = await getOauthClient(parsed.data.client_id);
  // Must stay the SAME predicate the authorize route gates on — a consent
  // screen that renders and then throws, or one laxer than authorize, are both
  // bugs. See redirect-uri.ts for why exact matching is not enough.
  if (
    !client ||
    !isRegisteredRedirectUri(client.redirect_uris, parsed.data.redirect_uri)
  ) {
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
