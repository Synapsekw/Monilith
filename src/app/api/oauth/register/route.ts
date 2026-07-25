import { NextResponse } from "next/server";
import { registerClientSchema } from "@/lib/validations/mcp-oauth";
import { registerOauthClient } from "@/lib/mcp/oauth/client-store";
import { checkRateLimit } from "@/lib/rate-limit/auth-rate-limit";

/**
 * The throttle response.
 *
 * RFC 7591 §3.2.2 shapes registration ERRORS as HTTP 400 with a closed code set
 * (invalid_redirect_uri / invalid_client_metadata / invalid_software_statement /
 * unapproved_software_statement). A throttle is not a registration error — the
 * submitted metadata IS valid — so answering 400/invalid_client_metadata would
 * tell the client to fix something it cannot fix, and would collide with this
 * route's real use of that code below.
 *
 * So: use the HTTP-registered signal for throttling — 429 + Retry-After (RFC
 * 6585 §4), which is what generic HTTP clients and MCP client retry logic key
 * on — while keeping the OAuth JSON envelope every other /api/oauth/* error
 * uses. `temporarily_unavailable` is the only REGISTERED OAuth 2.0 error code
 * (RFC 6749) meaning "temporarily unable to handle the request", i.e. retryable
 * rather than malformed. (`slow_down` was rejected: RFC 8628 scopes it to the
 * device authorization grant.)
 *
 * no-store stops an intermediary caching a transient throttle into a sticky
 * failure for a later legitimate connect. The body is identical whichever rule
 * fired and carries no remaining-count, so it cannot be used to probe how close
 * the global ceiling is.
 */
function throttled(retryAfterSeconds: number) {
  return NextResponse.json(
    {
      error: "temporarily_unavailable",
      error_description: `Too many registration requests. Please retry in ${retryAfterSeconds} seconds.`,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * RFC 7591 dynamic client registration — MCP clients (Claude Desktop,
 * claude.ai) call this once on first connect, no manual app setup.
 *
 * Unauthenticated by design, so it is rate limited FIRST — before the body is
 * even read. This deliberately differs from the auth server actions, which gate
 * AFTER their Zod parse because the parse yields the `email` dimension the gate
 * needs; here no dimension comes from the body, a flood of malformed bodies is
 * still a flood that must be counted, and a throttled request should never pay
 * for JSON parsing.
 */
export async function POST(req: Request) {
  const gate = await checkRateLimit({ endpoint: "oauthRegister" });
  if (!gate.allowed) return throttled(gate.retryAfterSeconds);

  const body = await req.json().catch(() => null);
  const parsed = registerClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: parsed.error.issues[0]?.message,
      },
      { status: 400 },
    );
  }
  const client = await registerOauthClient(parsed.data);
  return NextResponse.json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201 },
  );
}
