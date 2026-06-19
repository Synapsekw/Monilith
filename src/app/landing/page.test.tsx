import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getUser: () => getUser() }));
vi.mock("@/components/landing/monolith-hero", () => ({
  MonolithHero: ({ signedIn }: { signedIn?: boolean }) => (
    <div>monolith:{signedIn ? "in" : "out"}</div>
  ),
}));

import LandingPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LandingPage (/landing splash)", () => {
  it("renders the logged-out hero for visitors", async () => {
    getUser.mockResolvedValue(null);
    render(await LandingPage());
    expect(screen.getByText("monolith:out")).toBeInTheDocument();
  });

  it("renders the signed-in hero for authenticated viewers", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    render(await LandingPage());
    expect(screen.getByText("monolith:in")).toBeInTheDocument();
  });
});
