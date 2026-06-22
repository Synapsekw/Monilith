import { describe, expect, it, vi, beforeEach } from "vitest";

// Hold the auth.getUser() result the mocked Supabase client returns per test.
const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: () => getUser() },
  }),
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
});

describe("proxy()", () => {
  it("redirects an authenticated visitor on / to /home", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });

    const res = await proxy(req("/"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/home");
  });

  it("lets an anonymous visitor through on / (static landing, no redirect)", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await proxy(req("/"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects an anonymous visitor on a protected route to /login", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await proxy(req("/boards/b1"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("lets an authenticated visitor through on a protected route", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });

    const res = await proxy(req("/boards/b1"));

    expect(res.headers.get("location")).toBeNull();
  });
});

describe("proxy matcher", () => {
  const matcher = new RegExp(config.matcher[0]);

  it("skips the static public routes so they serve from the CDN", () => {
    expect(matcher.test("/login")).toBe(false);
    expect(matcher.test("/signup")).toBe(false);
    expect(matcher.test("/updates")).toBe(false);
  });

  it("still matches /, the OAuth callback, and protected routes", () => {
    expect(matcher.test("/")).toBe(true);
    expect(matcher.test("/auth/callback")).toBe(true);
    expect(matcher.test("/boards/b1")).toBe(true);
  });
});
