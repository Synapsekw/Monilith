import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { NextResponse } from "next/server";

// `mcp-handler`'s getPublicOrigin isn't installed until Task 9 — derive the
// origin inline here rather than pulling that dependency in early.
function getOrigin(req: Request): string {
  return new URL(req.url).origin;
}

// Discovery metadata is public, unauthenticated and spec-mandated to be readable
// cross-origin: a browser-based MCP client (claude.ai fetching this document
// from its own origin) cannot complete discovery without CORS, while a
// server-side client like Claude Desktop never notices it is missing — which is
// how a header-less version of this route reached production unnoticed.
//
// The headers come from mcp-handler's own metadata CORS handler — the very one
// the sibling RFC 9728 route mounts (src/app/.well-known/oauth-protected-resource/route.ts,
// which also gets them for free inside `protectedResourceHandler`). Reusing that
// single source instead of hand-rolling a header literal here is what stops the
// two well-known routes from drifting apart again.
const corsOptionsHandler = metadataCorsOptionsRequestHandler();

function metadataCorsHeaders(): Headers {
  return new Headers(corsOptionsHandler().headers);
}

/** RFC 8414 authorization server metadata — how MCP clients discover our endpoints. */
export async function GET(req: Request) {
  const origin = getOrigin(req);
  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    { headers: metadataCorsHeaders() },
  );
}

/** CORS preflight — without it Next.js answers a bare 204 `allow:` response. */
export const OPTIONS = corsOptionsHandler;
