import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandler,
} from "mcp-handler";

// RFC 9728 protected-resource metadata — how MCP clients (Claude Desktop,
// claude.ai) discover which authorization server fronts /api/mcp. On an
// unauthenticated request, mcp-handler's withMcpAuth (src/app/api/mcp/route.ts)
// returns a 401 with a WWW-Authenticate header pointing at this well-known
// path (its default `resourceMetadataPath`); mcp-handler builds that
// challenge but does not itself serve this route, so it has to be mounted
// separately. `authServerUrls` must match the `issuer` this app's own RFC
// 8414 metadata route returns (src/app/.well-known/oauth-authorization-server/route.ts),
// which is just this request's own origin — mirrored here via the same
// `new URL(req.url).origin` derivation rather than a hardcoded value, since
// the app runs at different origins in dev/prod.
function getOrigin(req: Request): string {
  return new URL(req.url).origin;
}

export async function GET(req: Request) {
  const origin = getOrigin(req);
  const handler = protectedResourceHandler({
    authServerUrls: [origin],
  });
  return handler(req);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
