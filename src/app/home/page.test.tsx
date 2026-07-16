import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const {
  getUser,
  getUserOrgs,
  listMyBoards,
  listSharedBoards,
  listWorkspacesCached,
  redirect,
  cookieStore,
  boardProbe,
} = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserOrgs: vi.fn(),
  listMyBoards: vi.fn(),
  listSharedBoards: vi.fn(),
  listWorkspacesCached: vi.fn(),
  // Real next/navigation redirect() throws to halt rendering — mirror that.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  cookieStore: new Map<string, string>(),
  boardProbe: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
  // The rendered empty state is a client component that calls useRouter().
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/session", () => ({
  getUser: () => getUser(),
  // No-op for these cases: the test users carry no must_change_password flag.
  enforcePasswordChange: () => {},
}));
// The page resolves the active org (cookie-scoped) rather than orgs[0]; derive
// it from the same getUserOrgs mock so each case's org list still drives it.
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: async () => (await getUserOrgs())[0] ?? null,
}));
vi.mock("@/lib/boards/queries", () => ({
  listMyBoards: () => listMyBoards(),
  listSharedBoards: () => listSharedBoards(),
}));
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: (orgId: string) => listWorkspacesCached(orgId),
}));
// The org-admin guard has its own unit tests; isolate the page from its RPC.
vi.mock("@/lib/org/guard", () => ({
  isOrgAdmin: () => Promise.resolve(false),
}));
vi.mock("@/lib/platform/guard", () => ({
  isPlatformAdmin: () => Promise.resolve(false),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) =>
      cookieStore.has(n) ? { name: n, value: cookieStore.get(n)! } : undefined,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ is: () => ({ maybeSingle: () => boardProbe() }) }),
      }),
    }),
    rpc: async () => ({ data: false, error: null }),
  }),
}));
vi.mock("@/components/shell/authenticated-shell", () => ({
  AuthenticatedShell: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

// The page is a sync Suspense wrapper; the cookie-bound dispatch logic lives in
// the inner async server component, which the project pattern renders/awaits.
import { HomeDispatch } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
});

const LAST = "0b9e2a51-6f5c-4d7a-9c3e-8f1d2b4a6c0e";

describe("Home dispatcher (/home)", () => {
  it("redirects a logged-out visitor to /login", async () => {
    getUser.mockResolvedValue(null);

    await expect(HomeDispatch()).rejects.toThrow("REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects a logged-in user with a board to that board", async () => {
    getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      user_metadata: {},
    });
    getUserOrgs.mockResolvedValue([{ id: "o1", name: "Acme" }]);
    listMyBoards.mockResolvedValue([{ id: "b1" }]);

    await expect(HomeDispatch()).rejects.toThrow("REDIRECT:/boards/b1");
    expect(redirect).toHaveBeenCalledWith("/boards/b1");
  });

  it("redirects straight to a valid last-board cookie with one probe and no list reads", async () => {
    getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      user_metadata: {},
    });
    cookieStore.set("pulse_last_board", LAST);
    boardProbe.mockResolvedValue({ data: { id: LAST }, error: null });

    await expect(HomeDispatch()).rejects.toThrow(`REDIRECT:/boards/${LAST}`);
    expect(boardProbe).toHaveBeenCalledTimes(1);
    expect(listMyBoards).not.toHaveBeenCalled();
  });

  it("falls through to the list dispatch when the cookie board is gone/RLS-hidden", async () => {
    getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      user_metadata: {},
    });
    cookieStore.set("pulse_last_board", LAST);
    boardProbe.mockResolvedValue({ data: null, error: null });
    getUserOrgs.mockResolvedValue([{ id: "o1", name: "Acme" }]);
    listMyBoards.mockResolvedValue([{ id: "b1" }]);
    listSharedBoards.mockResolvedValue([]);

    await expect(HomeDispatch()).rejects.toThrow("REDIRECT:/boards/b1");
  });

  it("ignores a malformed cookie without querying", async () => {
    getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      user_metadata: {},
    });
    cookieStore.set("pulse_last_board", "drop table boards");
    getUserOrgs.mockResolvedValue([]);
    listMyBoards.mockResolvedValue([]);
    listSharedBoards.mockResolvedValue([]);

    await expect(HomeDispatch()).rejects.toThrow("REDIRECT:/onboarding");
    expect(boardProbe).not.toHaveBeenCalled();
  });

  it("fetches orgs, boards and shared boards in parallel (no serial gating)", async () => {
    // Even the org-less user's board reads fire — the three lists are
    // independent, so none may await another. Decision order is still checked
    // sequentially after the single batch resolves.
    getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      user_metadata: {},
    });
    getUserOrgs.mockResolvedValue([]);
    listMyBoards.mockResolvedValue([]);
    listSharedBoards.mockResolvedValue([]);

    await expect(HomeDispatch()).rejects.toThrow("REDIRECT:/onboarding");
    expect(listMyBoards).toHaveBeenCalledTimes(1);
    expect(listSharedBoards).toHaveBeenCalledTimes(1);
  });

  it("redirects a logged-in user with no orgs to onboarding", async () => {
    getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      user_metadata: {},
    });
    getUserOrgs.mockResolvedValue([]);

    await expect(HomeDispatch()).rejects.toThrow("REDIRECT:/onboarding");
    expect(redirect).toHaveBeenCalledWith("/onboarding");
  });

  it("redirects a board-less member to their first shared board", async () => {
    getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      user_metadata: {},
    });
    getUserOrgs.mockResolvedValue([{ id: "o1", name: "Acme" }]);
    listMyBoards.mockResolvedValue([]);
    listSharedBoards.mockResolvedValue([{ id: "s1" }]);

    await expect(HomeDispatch()).rejects.toThrow("REDIRECT:/boards/s1");
    expect(redirect).toHaveBeenCalledWith("/boards/s1");
  });

  it("renders the first-board empty state (with template cards) for a user with no boards", async () => {
    getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      user_metadata: {},
    });
    getUserOrgs.mockResolvedValue([{ id: "o1", name: "Acme" }]);
    listMyBoards.mockResolvedValue([]);
    listSharedBoards.mockResolvedValue([]);
    listWorkspacesCached.mockResolvedValue([{ id: "ws1", name: "Main" }]);

    render(await HomeDispatch());

    expect(screen.getByText("Welcome to Acme")).toBeInTheDocument();
    // The empty state surfaces the template catalogue directly + a primary CTA.
    expect(
      screen.getByRole("button", { name: /create your first board/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sprint planning")).toBeInTheDocument();
    expect(listWorkspacesCached).toHaveBeenCalledWith("o1");
    expect(redirect).not.toHaveBeenCalled();
  });
});
