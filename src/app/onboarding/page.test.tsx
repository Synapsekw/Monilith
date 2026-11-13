import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const {
  requireUser,
  getUserOrgs,
  redeemInvitationsForUser,
  redirect,
  sessionClient,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getUserOrgs: vi.fn(),
  redeemInvitationsForUser: vi.fn(),
  // Real next/navigation redirect() throws to halt rendering — mirror that.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  sessionClient: { tag: "session-client" },
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
// requireUser (incl. its approval gate) has its own tests in session.test.ts.
vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUser(),
  getUserOrgs: () => getUserOrgs(),
}));
vi.mock("@/lib/auth/redeem", () => ({
  redeemInvitationsForUser: (...a: unknown[]) => redeemInvitationsForUser(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => sessionClient,
}));
vi.mock("@/components/onboarding/onboarding-form", () => ({
  OnboardingForm: () => <form aria-label="Create your organization" />,
}));

import { OnboardingGate } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u1" });
  getUserOrgs.mockResolvedValue([]);
  redeemInvitationsForUser.mockResolvedValue(0);
});

describe("Onboarding gate", () => {
  it("sends a user who already has an org home", async () => {
    getUserOrgs.mockResolvedValue([{ id: "o1", name: "Acme" }]);

    await expect(OnboardingGate()).rejects.toThrow("REDIRECT:/");
  });

  it("sends a user home once a pending invitation is redeemed", async () => {
    redeemInvitationsForUser.mockResolvedValue(1);

    await expect(OnboardingGate()).rejects.toThrow("REDIRECT:/");
    expect(redeemInvitationsForUser).toHaveBeenCalledWith(sessionClient);
  });

  it("shows the form when no invitation was redeemed", async () => {
    render(await OnboardingGate());

    expect(redeemInvitationsForUser).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("form", { name: "Create your organization" }),
    ).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("falls through to the form when redeeming fails", async () => {
    redeemInvitationsForUser.mockRejectedValue(new Error("rpc down"));

    render(await OnboardingGate());

    expect(
      screen.getByRole("form", { name: "Create your organization" }),
    ).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("runs the auth gate before anything else", async () => {
    requireUser.mockRejectedValue(new Error("REDIRECT:/pending-approval"));

    await expect(OnboardingGate()).rejects.toThrow(
      "REDIRECT:/pending-approval",
    );
    expect(getUserOrgs).not.toHaveBeenCalled();
    expect(redeemInvitationsForUser).not.toHaveBeenCalled();
  });
});
