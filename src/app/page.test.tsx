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
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: async () => ({ data: [] }) }),
    rpc: async () => ({ data: false, error: null }),
  }),
}));
vi.mock("@/components/landing/monolith-hero", () => ({
  MonolithHero: () => <a href="/login">MONOLITH</a>,
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import Home from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Home (root route)", () => {
  it("renders the landing for logged-out visitors", async () => {
    getUser.mockResolvedValue(null);

    render(await Home());

    expect(screen.getByRole("link")).toHaveAttribute("href", "/login");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects a logged-in user with a board to that board", async () => {
    getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      user_metadata: {},
    });
    getUserOrgs.mockResolvedValue([{ id: "o1", name: "Acme" }]);
    listMyBoards.mockResolvedValue([{ id: "b1" }]);

    await expect(Home()).rejects.toThrow("REDIRECT:/boards/b1");
    expect(redirect).toHaveBeenCalledWith("/boards/b1");
  });

  it("redirects a logged-in user with no orgs to onboarding", async () => {
    getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      user_metadata: {},
    });
    getUserOrgs.mockResolvedValue([]);

    await expect(Home()).rejects.toThrow("REDIRECT:/onboarding");
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

    await expect(Home()).rejects.toThrow("REDIRECT:/boards/s1");
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

    render(await Home());

    expect(screen.getByText("Welcome to Acme")).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });
});
