import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getUser: () => getUser() }));
vi.mock("@/components/landing/monolith-hero", () => ({
  MonolithHero: ({ signedIn }: { signedIn?: boolean }) => (
    <div>monolith:{signedIn ? "in" : "out"}</div>
  ),
}));

// The page is a sync Suspense wrapper; the cookie-bound logic lives in the inner
// async server component, which the project pattern renders by awaiting it.
import { LandingInner } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LandingPage (/landing splash)", () => {
  it("renders the logged-out hero for visitors", async () => {
    getUser.mockResolvedValue(null);
    render(await LandingInner());
    expect(screen.getByText("monolith:out")).toBeInTheDocument();
  });

  it("renders the signed-in hero for authenticated viewers", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    render(await LandingInner());
    expect(screen.getByText("monolith:in")).toBeInTheDocument();
  });
});
