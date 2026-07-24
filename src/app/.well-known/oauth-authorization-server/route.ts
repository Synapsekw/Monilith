import { NextResponse } from "next/server";

// `mcp-handler`'s getPublicOrigin isn't installed until Task 9 — derive the
// origin inline here rather than pulling that dependency in early.
function getOrigin(req: Request): string {
  return new URL(req.url).origin;
}

/** RFC 8414 authorization server metadata — how MCP clients discover our endpoints. */
export async function GET(req: Request) {
  const origin = getOrigin(req);
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
