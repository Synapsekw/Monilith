import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { getUser, getUserOrgs, listMyBoards, listSharedBoards, redirect } =
  vi.hoisted(() => ({
    getUser: vi.fn(),
    getUserOrgs: vi.fn(),
    listMyBoards: vi.fn(),
    listSharedBoards: vi.fn(),
    // Real next/navigation redirect() throws to halt rendering — mirror that.
    redirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
  }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
vi.mock("@/lib/auth/session", () => ({
  getUser: () => getUser(),
  getUserOrgs: () => getUserOrgs(),
  // No-op for these cases: the test users carry no must_change_password flag.
  enforcePasswordChange: () => {},
}));
vi.mock("@/lib/boards/queries", () => ({
  listMyBoards: () => listMyBoards(),
  listSharedBoards: () => listSharedBoards(),
}));
// The org-admin guard has its own unit tests; isolate the page from its RPC.
vi.mock("@/lib/org/guard", () => ({
  isOrgAdmin: () => Promise.resolve(false),
}));
vi.mock("@/lib/platform/guard", () => ({
  isPlatformAdmin: () => Promise.resolve(false),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: async () => ({ data: [] }) }),
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
});

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

  it("renders the welcome shell for a logged-in user with no boards", async () => {
    getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      user_metadata: {},
    });
    getUserOrgs.mockResolvedValue([{ id: "o1", name: "Acme" }]);
    listMyBoards.mockResolvedValue([]);
    listSharedBoards.mockResolvedValue([]);

    render(await HomeDispatch());

    expect(screen.getByText("Welcome to Acme")).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });
});
