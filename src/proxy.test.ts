import { describe, expect, it, vi, beforeEach } from "vitest";

// Hold the auth.getClaims() result the mocked Supabase client returns per test,
// and capture the cookie adapter so we can simulate a refresh writing cookies.
const { getClaims, capturedCookieAdapter } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  capturedCookieAdapter: {
    current: null as null | { setAll: (c: unknown[]) => void },
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { getAll: () => unknown[]; setAll: (c: unknown[]) => void };
    },
  ) => {
    capturedCookieAdapter.current = opts.cookies;
    return { auth: { getClaims: () => getClaims() } };
  },
}));
// Env validation runs at import; supply the two public vars the proxy reads.
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

import { NextRequest } from "next/server";
import { proxy, config } from "./proxy";

function req(path: string) {
  return new NextRequest(new URL(path, "http://localhost"));
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedCookieAdapter.current = null;
});

describe("proxy()", () => {
  it("redirects an authenticated visitor on / to /home", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "u1" } },
      error: null,
    });

    const res = await proxy(req("/"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/home");
  });

  it("lets an anonymous visitor through on / (static landing, no redirect)", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    const res = await proxy(req("/"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects an anonymous visitor on a protected route to /login", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    const res = await proxy(req("/boards/b1"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("treats a getClaims error as unauthenticated (redirect to /login)", async () => {
    getClaims.mockResolvedValue({ data: null, error: { message: "bad jwt" } });

    const res = await proxy(req("/boards/b1"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("lets an authenticated visitor through on a protected route", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "u1" } },
      error: null,
    });

    const res = await proxy(req("/boards/b1"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("calls getClaims with NO jwt arg (preserves getSession refresh path)", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "u1" } },
      error: null,
    });

    await proxy(req("/boards/b1"));

    // The zero-arg form is the one that routes through getSession() →
    // __loadSession() near-expiry refresh. Passing a token would skip refresh.
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(getClaims.mock.calls[0]).toHaveLength(0);
  });

  it("propagates refreshed cookies onto the response (refresh write-back works)", async () => {
    getClaims.mockImplementation(async () => {
      // Simulate @supabase/ssr writing a refreshed session via the adapter.
      capturedCookieAdapter.current?.setAll([
        { name: "sb-access-token", value: "refreshed", options: { path: "/" } },
      ]);
      return { data: { claims: { sub: "u1" } }, error: null };
    });

    const res = await proxy(req("/boards/b1"));

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sb-access-token=refreshed");
  });
});

describe("proxy matcher", () => {
  const matcher = new RegExp(config.matcher[0]);

  it("skips the static public routes so they serve from the CDN", () => {
    expect(matcher.test("/login")).toBe(false);
    expect(matcher.test("/signup")).toBe(false);
    expect(matcher.test("/updates")).toBe(false);
  });

  it("skips the web manifest so it never redirects to /login (installability)", () => {
    // The PWA manifest must be publicly fetchable — an anonymous visitor on the
    // landing page installs the app, so a proxy redirect to /login would return
    // login HTML instead of the manifest JSON and break the install prompt.
    expect(matcher.test("/manifest.webmanifest")).toBe(false);
  });

  it("still matches /, the OAuth callback, and protected routes", () => {
    expect(matcher.test("/")).toBe(true);
    expect(matcher.test("/auth/callback")).toBe(true);
    expect(matcher.test("/boards/b1")).toBe(true);
  });
});
