import { describe, it, expect, vi, beforeEach } from "vitest";

const consumeAuthorizationCode = vi.fn();
const verifyPkce = vi.fn();
const mintBridgeSecret = vi.fn();
const issueTokenPair = vi.fn();
const rotateTokenPair = vi.fn();

vi.mock("@/lib/mcp/oauth/code-store", () => ({
  consumeAuthorizationCode: (...a: unknown[]) => consumeAuthorizationCode(...a),
}));
vi.mock("@/lib/mcp/oauth/crypto", () => ({
  verifyPkce: (...a: unknown[]) => verifyPkce(...a),
}));
vi.mock("@/lib/mcp/oauth/session-bridge", () => ({
  mintBridgeSecret: (...a: unknown[]) => mintBridgeSecret(...a),
}));
vi.mock("@/lib/mcp/oauth/token-store", () => ({
  issueTokenPair: (...a: unknown[]) => issueTokenPair(...a),
  rotateTokenPair: (...a: unknown[]) => rotateTokenPair(...a),
}));

import { POST } from "./route";

const REDIRECT_URI = "http://127.0.0.1:42447/callback";
const VERIFIER = "v".repeat(64);

function tokenRequest(over: Record<string, string> = {}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: "the-code",
    client_id: "client-1",
    code_verifier: VERIFIER,
    redirect_uri: REDIRECT_URI,
    ...over,
  });
  return new Request("https://www.monolith.works/api/oauth/token", {
    method: "POST",
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  consumeAuthorizationCode.mockResolvedValue({
    client_id: "client-1",
    user_id: "user-1",
    redirect_uri: REDIRECT_URI,
    code_challenge: "challenge",
  });
  verifyPkce.mockReturnValue(true);
  mintBridgeSecret.mockResolvedValue("secret-1");
  issueTokenPair.mockResolvedValue({
    accessToken: "at",
    refreshToken: "rt",
    expiresIn: 3600,
  });
});

describe("POST /api/oauth/token — authorization_code grant", () => {
  it("issues a bearer token pair on the happy path", async () => {
    const res = await POST(tokenRequest());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      access_token: "at",
      refresh_token: "rt",
      token_type: "bearer",
      expires_in: 3600,
    });
  });

  it("rejects a code whose redirect_uri does not match the one recorded", async () => {
    const res = await POST(
      tokenRequest({ redirect_uri: "http://127.0.0.1:45011/callback" }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  it("rejects a failed PKCE verification", async () => {
    verifyPkce.mockReturnValue(false);
    const res = await POST(tokenRequest());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_grant" });
    expect(mintBridgeSecret).not.toHaveBeenCalled();
  });

  it("rejects an already-consumed or unknown code", async () => {
    consumeAuthorizationCode.mockResolvedValue(null);
    const res = await POST(tokenRequest());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });
});

/**
 * A bridge mint reaches GoTrue and Vault. When it threw, the route answered a
 * bare 500 with an EMPTY body — the MCP client could only report "500, no
 * token" (this is how the secrets_name_idx collision presented in production).
 */
describe("POST /api/oauth/token — server-side failure envelope", () => {
  it("answers RFC 6749 server_error JSON when the bridge mint throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mintBridgeSecret.mockRejectedValue(
      new Error(
        'duplicate key value violates unique constraint "secrets_name_idx"',
      ),
    );

    const res = await POST(tokenRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("server_error");
    expect(body.error_description).toBeTruthy();

    // The real cause must reach the server log, never the client response.
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).toContain("secrets_name_idx");
    expect(JSON.stringify(body)).not.toContain("secrets_name_idx");
    spy.mockRestore();
  });

  it("answers server_error when persisting the token pair throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    issueTokenPair.mockRejectedValue(new Error("insert failed"));

    const res = await POST(tokenRequest());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "server_error" });
    spy.mockRestore();
  });
});

describe("POST /api/oauth/token — refresh_token grant", () => {
  it("rotates and returns a new pair", async () => {
    rotateTokenPair.mockResolvedValue({
      accessToken: "at2",
      refreshToken: "rt2",
      expiresIn: 3600,
    });
    const res = await POST(
      tokenRequest({ grant_type: "refresh_token", refresh_token: "rt" }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ access_token: "at2" });
  });

  it("rejects an unknown or revoked refresh token", async () => {
    rotateTokenPair.mockResolvedValue(null);
    const res = await POST(
      tokenRequest({ grant_type: "refresh_token", refresh_token: "nope" }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });
});

describe("POST /api/oauth/token — RFC 8252 §7.1 private-use scheme clients", () => {
  const APP_SCHEME = "cursor://anysphere.cursor-retrieval/callback";

  it("exchanges a code whose redirect_uri is an app scheme", async () => {
    consumeAuthorizationCode.mockResolvedValue({
      client_id: "client-1",
      user_id: "user-1",
      redirect_uri: APP_SCHEME,
      code_challenge: "challenge",
    });
    const res = await POST(tokenRequest({ redirect_uri: APP_SCHEME }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ access_token: "at" });
  });

  it("still rejects a script-scheme redirect_uri", async () => {
    const res = await POST(
      tokenRequest({ redirect_uri: "javascript:alert(1)" }),
    );
    expect(res.status).toBe(400);
    expect(consumeAuthorizationCode).not.toHaveBeenCalled();
  });
});
