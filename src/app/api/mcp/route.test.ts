import { describe, expect, it, vi } from "vitest";

/**
 * The MCP transport itself — `createMcpHandler` + `withMcpAuth` — had no test
 * before the mcp-handler v2 upgrade, so nothing but a live client would have
 * caught a broken handler wiring. These drive the REAL exported route handler
 * over the REAL JSON-RPC transport; only the auth/Supabase boundary is faked.
 */
vi.mock("@/lib/mcp/context", () => ({
  resolveMcpAuth: async (_req: Request, bearerToken?: string) =>
    bearerToken === "good-token"
      ? {
          token: bearerToken,
          clientId: "test-client",
          scopes: [],
          extra: {
            userId: "00000000-0000-0000-0000-000000000000",
            tokenRowId: "00000000-0000-0000-0000-000000000001",
            bridgeSecretId: "00000000-0000-0000-0000-000000000002",
          },
        }
      : undefined,
  mcpActorId: () => "00000000-0000-0000-0000-000000000000",
  getRequestClient: async () => {
    throw new Error("not used — no tool is invoked in these tests");
  },
}));

const { POST } = await import("./route");
const { ALL_TOOL_DESCRIPTORS } = await import("@/lib/mcp/tools/catalog");

const URL_ = "https://www.monolith.works/api/mcp";

function rpc(body: unknown, token?: string): Request {
  return new Request(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "route-test", version: "1.0.0" },
  },
};

/** The handler may answer JSON or a one-event SSE stream depending on the
 *  negotiated response mode; both carry the same JSON-RPC payload. */
async function jsonRpcBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(line!.slice("data:".length).trim());
  }
  return JSON.parse(text);
}

describe("POST /api/mcp", () => {
  it("challenges an unauthenticated request with the resource metadata URL", async () => {
    const res = await POST(rpc(INITIALIZE));
    expect(res.status).toBe(401);
    // Without this header a client cannot discover which authorization server
    // fronts the endpoint, and the whole OAuth handshake never starts.
    expect(res.headers.get("www-authenticate")).toContain(
      "/.well-known/oauth-protected-resource",
    );
  });

  it("rejects a bearer token that resolves to no user", async () => {
    const res = await POST(rpc(INITIALIZE, "bad-token"));
    expect(res.status).toBe(401);
  });

  it("completes the initialize handshake for an authenticated client", async () => {
    const res = await POST(rpc(INITIALIZE, "good-token"));
    expect(res.status).toBe(200);
    const body = await jsonRpcBody(res);
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "monolith", version: "1.0.0" } },
    });
  });

  it("serves every catalog tool over tools/list", async () => {
    const init = await POST(rpc(INITIALIZE, "good-token"));
    const sessionId = init.headers.get("mcp-session-id");
    await jsonRpcBody(init);

    const req = new Request(URL_, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer good-token",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await jsonRpcBody(res);
    const tools = (body.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(
      ALL_TOOL_DESCRIPTORS.map((d) => d.name).sort(),
    );
  });
});
