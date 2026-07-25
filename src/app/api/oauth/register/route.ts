import { NextResponse } from "next/server";
import { registerClientSchema } from "@/lib/validations/mcp-oauth";
import { registerOauthClient } from "@/lib/mcp/oauth/client-store";

/**
 * RFC 7591 dynamic client registration — MCP clients (Claude Desktop,
 * claude.ai) call this once on first connect, no manual app setup.
 */
export async function POST(req: Request) {
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
