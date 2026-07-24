import { NextResponse } from "next/server";
import { tokenExchangeSchema } from "@/lib/validations/mcp-oauth";
import { consumeAuthorizationCode } from "@/lib/mcp/oauth/code-store";
import { verifyPkce } from "@/lib/mcp/oauth/crypto";
import { mintBridgeSecret } from "@/lib/mcp/oauth/session-bridge";
import { issueTokenPair, rotateTokenPair } from "@/lib/mcp/oauth/token-store";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form)
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const parsed = tokenExchangeSchema.safeParse(
    Object.fromEntries(form.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: parsed.error.issues[0]?.message,
      },
      { status: 400 },
    );
  }

  if (parsed.data.grant_type === "authorization_code") {
    const codeRow = await consumeAuthorizationCode(parsed.data.code);
    if (!codeRow || codeRow.client_id !== parsed.data.client_id) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (codeRow.redirect_uri !== parsed.data.redirect_uri) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (!verifyPkce(parsed.data.code_verifier, codeRow.code_challenge)) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    const bridgeSecretId = await mintBridgeSecret(codeRow.user_id);
    const tokens = await issueTokenPair({
      clientId: parsed.data.client_id,
      userId: codeRow.user_id,
      bridgeSecretId,
    });
    return NextResponse.json({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_type: "bearer",
      expires_in: tokens.expiresIn,
    });
  }

  // refresh_token grant
  const tokens = await rotateTokenPair(
    parsed.data.refresh_token,
    parsed.data.client_id,
  );
  if (!tokens) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }
  return NextResponse.json({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: "bearer",
    expires_in: tokens.expiresIn,
  });
}
