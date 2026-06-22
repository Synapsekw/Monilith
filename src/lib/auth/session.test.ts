import { beforeEach, describe, expect, it, vi } from "vitest";

// getClaims verifies the JWT locally (asymmetric signing keys); we mock it to
// drive each case. redirect() throws to halt, like the real next/navigation.
const { getClaims, redirect } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims } }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

// getUser is wrapped in React cache() (no-arg → memoizes for the cache
// lifetime). Reset modules per test so each gets a fresh, un-memoized getUser.
beforeEach(() => {
  vi.resetModules();
  getClaims.mockReset();
  redirect.mockClear();
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
