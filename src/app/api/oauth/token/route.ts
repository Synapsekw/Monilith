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
    // Bridge minting reaches GoTrue and Vault, so it can fail for reasons the
    // client cannot fix (rate limits, a Vault constraint). Uncaught, Next
    // answered a bare 500 with an EMPTY body: the MCP client reported only
    // "500, no token" and the real cause was visible nowhere but the platform
    // logs. RFC 6749 §5.2 has a registered code for exactly this, so return the
    // JSON envelope every other branch here uses and log the cause server-side.
    try {
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
    } catch (e) {
      console.error("[oauth/token] code redemption failed:", {
        clientId: parsed.data.client_id,
        userId: codeRow.user_id,
        error: e instanceof Error ? e.message : String(e),
      });
      return NextResponse.json(
        {
          error: "server_error",
          error_description:
            "Could not complete the token exchange. Please retry the authorization.",
        },
        { status: 500 },
      );
    }
  }

  // refresh_token grant
  // rotateTokenPair returns null for a token that is unknown, revoked, expired
  // or another client's, and THROWS when the database call itself failed. Only
  // the first is invalid_grant: a client that is told invalid_grant discards
  // the connection and asks the user to sign in again, which a database blip
  // must never cause. 503 tells it to keep its refresh token and retry.
  let tokens: Awaited<ReturnType<typeof rotateTokenPair>>;
  try {
    tokens = await rotateTokenPair(
      parsed.data.refresh_token,
      parsed.data.client_id,
    );
  } catch (e) {
    console.error("[oauth/token] refresh rotation failed:", {
      clientId: parsed.data.client_id,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      {
        error: "temporarily_unavailable",
        error_description: "Could not refresh the token. Please retry.",
      },
      { status: 503 },
    );
  }
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
