import { beforeEach, describe, expect, it, vi } from "vitest";

// checkRateLimit is mocked WHOLESALE rather than at the RPC level: the real one
// resolves the client IP through next/headers, which needs a request scope a
// route unit test has no business faking. The rule/bucket-key/fail-closed
// behavior is covered in src/lib/rate-limit/auth-rate-limit.test.ts.
const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit/auth-rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
}));

const registerOauthClient = vi.fn();
vi.mock("@/lib/mcp/oauth/client-store", () => ({
  registerOauthClient: (...a: unknown[]) => registerOauthClient(...a),
}));

import { POST } from "./route";

const VALID = {
  client_name: "Claude Desktop",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
};

/** Build a POST Request. Pass a string to send a deliberately unparseable body. */
function req(body: unknown) {
  return new Request("http://x/api/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const throttle = (retryAfterSeconds: number) => ({
  allowed: false,
  retryAfterSeconds,
});

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ allowed: true });
  registerOauthClient.mockResolvedValue({
    client_id: "c1",
    client_name: VALID.client_name,
    redirect_uris: VALID.redirect_uris,
  });
});

describe("POST /api/oauth/register — rate limit gate", () => {
  it("gates on the oauthRegister endpoint exactly once", async () => {
    await POST(req(VALID));
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith({ endpoint: "oauthRegister" });
  });

  it("returns 429 with Retry-After and the OAuth error body when throttled", async () => {
    checkRateLimit.mockResolvedValue(throttle(47));
    const res = await POST(req(VALID));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("47");
    const body = (await res.json()) as Record<string, string>;
    expect(body.error).toBe("temporarily_unavailable");
    expect(body.error_description).toContain("47");
  });

  it("writes NO client row when throttled", async () => {
    checkRateLimit.mockResolvedValue(throttle(47));
    await POST(req(VALID));
    expect(registerOauthClient).not.toHaveBeenCalled();
  });

  it("marks the throttle response no-store", async () => {
    checkRateLimit.mockResolvedValue(throttle(47));
    const res = await POST(req(VALID));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("leaks no dimension or remaining count in the throttle body", async () => {
    checkRateLimit.mockResolvedValue(throttle(47));
    const res = await POST(req(VALID));
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["error", "error_description"]);
    expect(JSON.stringify(body)).not.toMatch(/remaining|global|\bip\b/i);
  });

  it("gates BEFORE parsing the body — a malformed body while throttled is 429, not 400", async () => {
    checkRateLimit.mockResolvedValue(throttle(5));
    const res = await POST(req("not json"));
    expect(res.status).toBe(429);
  });
});

describe("POST /api/oauth/register — existing behavior is unchanged", () => {
  it("registers and returns 201 when the gate allows", async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      client_id: "c1",
      client_name: "Claude Desktop",
      redirect_uris: VALID.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(registerOauthClient).toHaveBeenCalledWith(VALID);
  });

  it("still rejects invalid metadata with 400 invalid_client_metadata", async () => {
    const res = await POST(req({ client_name: "", redirect_uris: [] }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid_client_metadata",
    });
    expect(registerOauthClient).not.toHaveBeenCalled();
  });

  it("still rejects an unparseable body with 400 when the gate allows", async () => {
    const res = await POST(req("not json"));
    expect(res.status).toBe(400);
    expect(registerOauthClient).not.toHaveBeenCalled();
  });
});
