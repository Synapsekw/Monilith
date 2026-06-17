import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { getUser, getUserOrgs, listBoards, redirect } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserOrgs: vi.fn(),
  listBoards: vi.fn(),
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
}));
vi.mock("@/lib/boards/queries", () => ({ listBoards: () => listBoards() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: async () => ({ data: [] }) }),
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
    listBoards.mockResolvedValue([{ id: "b1" }]);

    await expect(Home()).rejects.toThrow("REDIRECT:/boards/b1");
    expect(redirect).toHaveBeenCalledWith("/boards/b1");
  });
});
