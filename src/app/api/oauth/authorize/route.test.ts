import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const getOauthClient = vi.fn();
const redirect = vi.fn((to: string) => {
  // Mirrors next/navigation: redirect() THROWS to unwind the handler. Without
  // this the route would fall through past its redirect and the test would
  // assert on code that never runs in production.
  throw new Error(`NEXT_REDIRECT:${to}`);
});

vi.mock("@/lib/auth/session", () => ({ getUser: () => getUser() }));
vi.mock("@/lib/mcp/oauth/client-store", () => ({
  getOauthClient: (...a: unknown[]) => getOauthClient(...a),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
}));

import { GET } from "./route";

const REGISTERED_LOOPBACK = "http://127.0.0.1:38559/callback";
const CODE_CHALLENGE = "a".repeat(43);

function authorizeUrl(over: Record<string, string> = {}) {
  const url = new URL("https://www.monolith.works/api/oauth/authorize");
  const params: Record<string, string> = {
    client_id: "client-1",
    redirect_uri: REGISTERED_LOOPBACK,
    response_type: "code",
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: "S256",
    state: "xyz",
    ...over,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** Runs GET and returns either the Response or the redirect target. */
async function run(url: string): Promise<Response | { redirectedTo: string }> {
  try {
    return await GET(new Request(url));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const prefix = "NEXT_REDIRECT:";
    if (!message.startsWith(prefix)) throw e;
    return { redirectedTo: message.slice(prefix.length) };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ id: "user-1" });
  getOauthClient.mockResolvedValue({ redirect_uris: [REGISTERED_LOOPBACK] });
});

describe("GET /api/oauth/authorize", () => {
  it("sends a signed-in user to the consent screen, preserving every param", async () => {
    const result = await run(authorizeUrl());
    expect(result).toHaveProperty("redirectedTo");
    const target = new URL((result as { redirectedTo: string }).redirectedTo);
    expect(target.pathname).toBe("/oauth/consent");
    expect(target.searchParams.get("client_id")).toBe("client-1");
    expect(target.searchParams.get("redirect_uri")).toBe(REGISTERED_LOOPBACK);
    expect(target.searchParams.get("state")).toBe("xyz");
    expect(target.searchParams.get("code_challenge")).toBe(CODE_CHALLENGE);
  });

  it("bounces an unauthenticated visitor to /login carrying the full request as next", async () => {
    getUser.mockResolvedValue(null);
    const result = await run(authorizeUrl());
    const to = (result as { redirectedTo: string }).redirectedTo;
    expect(to.startsWith("/login?next=")).toBe(true);
    const next = new URLSearchParams(to.slice("/login?".length)).get("next");
    expect(next).toContain("/api/oauth/authorize");
    expect(next).toContain("code_challenge");
  });

  it("400s a malformed request before looking up the client", async () => {
    const res = (await run(
      authorizeUrl({ code_challenge_method: "plain" }),
    )) as Response;
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/invalid_request/);
    expect(getOauthClient).not.toHaveBeenCalled();
  });

  it("400s invalid_client for an unknown client_id", async () => {
    getOauthClient.mockResolvedValue(null);
    const res = (await run(authorizeUrl())) as Response;
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("invalid_client");
  });

  it("400s invalid_client for a redirect_uri the client never registered", async () => {
    const res = (await run(
      authorizeUrl({ redirect_uri: "https://evil.example.com/steal" }),
    )) as Response;
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("invalid_client");
  });

  // The regression this whole change exists for: a CLI client's second login
  // arrives on a NEW ephemeral port and used to be rejected invalid_client.
  it("accepts a different ephemeral loopback port (RFC 8252 §7.3)", async () => {
    const presented = "http://127.0.0.1:45011/callback";
    const result = await run(authorizeUrl({ redirect_uri: presented }));
    expect(result).toHaveProperty("redirectedTo");
    const target = new URL((result as { redirectedTo: string }).redirectedTo);
    expect(target.pathname).toBe("/oauth/consent");
    expect(target.searchParams.get("redirect_uri")).toBe(presented);
  });

  it("still 400s a different PATH on the loopback interface", async () => {
    const res = (await run(
      authorizeUrl({ redirect_uri: "http://127.0.0.1:45011/evil" }),
    )) as Response;
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("invalid_client");
  });
});

describe("GET /api/oauth/authorize — RFC 8252 §7.1 private-use scheme clients", () => {
  const APP_SCHEME = "cursor://anysphere.cursor-retrieval/callback";

  it("carries a registered app-scheme callback through to consent", async () => {
    getOauthClient.mockResolvedValue({ redirect_uris: [APP_SCHEME] });
    getUser.mockResolvedValue({ id: "user-1" });

    const result = await run(authorizeUrl({ redirect_uri: APP_SCHEME }));
    expect(result).toHaveProperty("redirectedTo");
    const target = new URL((result as { redirectedTo: string }).redirectedTo);
    expect(target.pathname).toBe("/oauth/consent");
    expect(target.searchParams.get("redirect_uri")).toBe(APP_SCHEME);
  });

  it("sends an unauthenticated app-scheme request to login first", async () => {
    getOauthClient.mockResolvedValue({ redirect_uris: [APP_SCHEME] });
    getUser.mockResolvedValue(null);

    const result = await run(authorizeUrl({ redirect_uri: APP_SCHEME }));
    expect((result as { redirectedTo: string }).redirectedTo).toMatch(
      /^\/login\?next=/,
    );
  });

  it("still 400s a script-scheme redirect_uri before any client lookup", async () => {
    const result = await run(
      authorizeUrl({ redirect_uri: "javascript:alert(1)" }),
    );
    expect((result as Response).status).toBe(400);
    expect(getOauthClient).not.toHaveBeenCalled();
  });
});
