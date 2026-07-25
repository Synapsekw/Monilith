import { beforeEach, describe, expect, it, vi } from "vitest";

// getClaims verifies the JWT locally (asymmetric signing keys); we mock it to
// drive each case. redirect() throws to halt, like the real next/navigation.
// from() drives the getUserOrgs organizations read.
const { getClaims, redirect, from, headerMap } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  from: vi.fn(),
  headerMap: new Map<string, string>(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims }, from }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
// Mirrors src/app/auth/actions.test.ts: a Map stands in for the header store —
// only `.get()` is used.
vi.mock("next/headers", () => ({ headers: async () => headerMap }));

// getUser is wrapped in React cache() (no-arg → memoizes for the cache
// lifetime). Reset modules per test so each gets a fresh, un-memoized getUser.
beforeEach(() => {
  vi.resetModules();
  getClaims.mockReset();
  redirect.mockClear();
  from.mockReset();
  headerMap.clear();
});

function claims(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      claims: { sub: "u1", email: "a@b.com", ...overrides },
    },
    error: null,
  };
}

describe("getUser", () => {
  it("maps verified claims to a SessionUser", async () => {
    getClaims.mockResolvedValue(
      claims({ user_metadata: { full_name: "Ada" }, app_metadata: { x: 1 } }),
    );
    const { getUser } = await import("./session");

    expect(await getUser()).toEqual({
      id: "u1",
      email: "a@b.com",
      user_metadata: { full_name: "Ada" },
      app_metadata: { x: 1 },
    });
  });

  it("defaults the metadata bags to {} when the token omits them", async () => {
    getClaims.mockResolvedValue(claims());
    const { getUser } = await import("./session");

    expect(await getUser()).toEqual({
      id: "u1",
      email: "a@b.com",
      user_metadata: {},
      app_metadata: {},
    });
  });

  it("returns null when there is no valid session (error)", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("no jwt") });
    const { getUser } = await import("./session");

    expect(await getUser()).toBeNull();
  });

  it("returns null when there are no claims", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const { getUser } = await import("./session");

    expect(await getUser()).toBeNull();
  });
});

describe("getUserOrgs", () => {
  function orgsRead(result: {
    data: unknown[] | null;
    error: { message: string } | null;
  }) {
    from.mockReturnValue({ select: vi.fn(async () => result) });
  }

  it("returns the RLS-scoped orgs", async () => {
    const rows = [{ id: "o1", name: "Acme", timezone: "UTC" }];
    orgsRead({ data: rows, error: null });
    const { getUserOrgs } = await import("./session");

    expect(await getUserOrgs()).toEqual(rows);
    expect(from).toHaveBeenCalledWith("organizations");
  });

  it("returns [] when the user genuinely belongs to no org", async () => {
    orgsRead({ data: [], error: null });
    const { getUserOrgs } = await import("./session");

    expect(await getUserOrgs()).toEqual([]);
  });

  it("throws on a DB error instead of returning [] (a failure is not 'no org')", async () => {
    // Silent [] here misrouted users to /onboarding on transient DB failures
    // (home/page.tsx and onboarding/page.tsx treat [] as "no org yet").
    orgsRead({ data: null, error: { message: "connection refused" } });
    const { getUserOrgs } = await import("./session");

    await expect(getUserOrgs()).rejects.toThrow(
      /Failed to load organizations: connection refused/,
    );
  });
});

describe("requireUser", () => {
  it("redirects to /login when unauthenticated", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const { requireUser } = await import("./session");

    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects a flagged user to /change-password", async () => {
    getClaims.mockResolvedValue(
      claims({ app_metadata: { must_change_password: true } }),
    );
    const { requireUser } = await import("./session");

    await expect(requireUser()).rejects.toThrow("REDIRECT:/change-password");
    expect(redirect).toHaveBeenCalledWith("/change-password");
  });

  it("returns the user when authenticated and not flagged", async () => {
    getClaims.mockResolvedValue(claims({ app_metadata: { role: "member" } }));
    const { requireUser } = await import("./session");

    const user = await requireUser();
    expect(user.id).toBe("u1");
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("requireUser — ?next= carrying", () => {
  it("carries the proxy-stamped path so the user resumes after sign-in", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    headerMap.set("x-pulse-path", "/boards/b1?tab=x");
    const { requireUser } = await import("./session");

    await expect(requireUser()).rejects.toThrow(
      "REDIRECT:/login?next=%2Fboards%2Fb1%3Ftab%3Dx",
    );
  });

  it("falls back to a bare /login when the header is absent", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const { requireUser } = await import("./session");

    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("ignores a hostile header value", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    headerMap.set("x-pulse-path", "https://evil.com");
    const { requireUser } = await import("./session");

    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("does not add next to the forced password-change redirect", async () => {
    getClaims.mockResolvedValue(
      claims({ app_metadata: { must_change_password: true } }),
    );
    headerMap.set("x-pulse-path", "/boards/b1");
    const { requireUser } = await import("./session");

    await expect(requireUser()).rejects.toThrow("REDIRECT:/change-password");
  });
});
