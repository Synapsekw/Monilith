import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getUser: () => getUser() }));
vi.mock("@/components/landing/monolith-hero", () => ({
  MonolithHero: ({ href }: { href?: string }) => <a href={href}>MONOLITH</a>,
}));

import LandingPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LandingPage (/landing splash)", () => {
  it("sends logged-out visitors to /login", async () => {
    getUser.mockResolvedValue(null);

    render(await LandingPage());

    expect(screen.getByRole("link")).toHaveAttribute("href", "/login");
  });

  it("sends signed-in viewers back into the app", async () => {
    getUser.mockResolvedValue({ id: "u1" });

    render(await LandingPage());

    expect(screen.getByRole("link")).toHaveAttribute("href", "/");
  });
});
