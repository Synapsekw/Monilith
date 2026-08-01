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

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

  it("redirects an anonymous visitor on a protected route to /login?next=", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    const res = await proxy(req("/boards/b1"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?next=%2Fboards%2Fb1",
    );
  });

  it("preserves the query string in next", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    const res = await proxy(req("/oauth/consent?client_id=a&state=b"));

    expect(res.headers.get("location")).toBe(
      "http://localhost/login?next=%2Foauth%2Fconsent%3Fclient_id%3Da%26state%3Db",
    );
  });

  it("treats a getClaims error as unauthenticated (redirect to /login?next=)", async () => {
    getClaims.mockResolvedValue({ data: null, error: { message: "bad jwt" } });

    const res = await proxy(req("/boards/b1"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?next=%2Fboards%2Fb1",
    );
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

describe("proxy() — x-pulse-path request header", () => {
  it("stamps the resolved path on the FORWARDED REQUEST for an authenticated visitor", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "u1" } },
      error: null,
    });

    const res = await proxy(req("/boards/b1?tab=x"));

    // NextResponse.next({ request: { headers } }) encodes upstream request
    // headers as x-middleware-request-* (verified against next@16.2.9).
    expect(res.headers.get("x-middleware-request-x-pulse-path")).toBe(
      "/boards/b1?tab=x",
    );
    // It must NOT be a client-visible response header.
    expect(res.headers.get("x-pulse-path")).toBeNull();
  });

  it("forwards the REFRESHED cookie upstream, not a stale snapshot", async () => {
    // Same idiom as the existing "propagates refreshed cookies" test: the
    // adapter writes during getClaims. This is the regression guard for cloning
    // request.headers too early — a snapshot taken before setAll() would forward
    // the OLD Cookie header to the app and silently log the user out.
    getClaims.mockImplementation(async () => {
      capturedCookieAdapter.current?.setAll([
        { name: "sb-access-token", value: "refreshed", options: { path: "/" } },
      ]);
      return { data: { claims: { sub: "u1" } }, error: null };
    });

    const res = await proxy(req("/boards/b1"));

    expect(res.headers.get("set-cookie") ?? "").toContain(
      "sb-access-token=refreshed",
    );
    expect(res.headers.get("x-middleware-request-cookie") ?? "").toContain(
      "sb-access-token=refreshed",
    );
    expect(res.headers.get("x-middleware-request-x-pulse-path")).toBe(
      "/boards/b1",
    );
  });
});

describe("proxy() — cookieless OAuth/MCP endpoints are not login-walled", () => {
  beforeEach(() => {
    getClaims.mockResolvedValue({ data: null, error: null });
  });

  it.each([
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/api/oauth/register",
    "/api/oauth/token",
    "/api/oauth/authorize?client_id=a&response_type=code",
    "/api/mcp",
  ])("lets an anonymous request through on %s", async (path) => {
    const res = await proxy(req(path));

    // No redirect: the endpoint authenticates itself (Bearer / PKCE / public
    // metadata) and must be free to answer 200 / 400 / 401 WWW-Authenticate.
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/boards/b1", "/settings", "/oauth/consent", "/admin"])(
    "still gates %s behind /login",
    async (path) => {
      const res = await proxy(req(path));

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/login?next=");
    },
  );
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

  it("still MATCHES the OAuth/MCP endpoints — they are allowlisted in proxy(), not excluded here", () => {
    // The matcher must keep running on /api/* so authenticated app API routes
    // still get session refresh; the cookieless endpoints are exempted inside
    // proxy() by PUBLIC_PREFIXES instead.
    expect(matcher.test("/api/mcp")).toBe(true);
    expect(matcher.test("/api/oauth/token")).toBe(true);
    expect(matcher.test("/.well-known/oauth-protected-resource")).toBe(true);
  });
});

describe("pg_cron endpoints are exempt from the cookie gate", () => {
  // The endpoints pg_cron POSTs to via pg_net, derived from the migrations rather
  // than hardcoded here. A cron call carries NO session cookie, so any of these
  // left out of PUBLIC_PREFIXES gets 307'd to /login — and a POST to /login (a
  // page route) answers 405. pg_net records that in net._http_response, but
  // nothing surfaces it, so the cron job still reports `succeeded` while its work
  // silently never runs. That is exactly what happened to embed-sweep,
  // automation-ai-reconcile, autopilot-sweep and health-digest-ping in production
  // until 2026-08-01. Deriving the list means a NEW cron endpoint added without an
  // exemption fails here instead of in prod.
  function cronEndpointsFromMigrations(): string[] {
    const dir = join(process.cwd(), "supabase", "migrations");
    const found = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
      const sql = readFileSync(join(dir, f), "utf8");
      // `url := v_url || '/api/…'` — the pg_net call sites.
      for (const m of sql.matchAll(/\|\|\s*'(\/api\/[a-z0-9/_-]+)'/g)) {
        found.add(m[1]);
      }
    }
    return [...found].sort();
  }

  const endpoints = cronEndpointsFromMigrations();

  it("finds the cron endpoints in the migrations (guards the regex itself)", () => {
    // If this ever reads empty the loop below would pass vacuously.
    expect(endpoints.length).toBeGreaterThanOrEqual(4);
    expect(endpoints).toContain("/api/ai/embed");
  });

  it.each(endpoints)(
    "%s reaches its handler instead of redirecting to /login",
    async (path) => {
      getClaims.mockResolvedValue({
        data: null,
        error: { message: "no session" },
      });
      const res = await proxy(req(path));
      expect(res.status).not.toBe(307);
      expect(res.headers.get("location")).toBeNull();
    },
  );
});
