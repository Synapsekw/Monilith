import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const {
  requireUser,
  getUserOrgs,
  finishAccountSetup,
  orgsAfter,
  redirect,
  sessionClient,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getUserOrgs: vi.fn(),
  finishAccountSetup: vi.fn(),
  orgsAfter: { value: [] as { id: string }[] },
  // Real next/navigation redirect() throws to halt rendering — mirror that.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  sessionClient: {
    tag: "session-client",
    from: () => ({
      select: () => ({
        limit: async () => ({ data: orgsAfter.value, error: null }),
      }),
    }),
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
// requireUser (incl. its approval gate) has its own tests in session.test.ts.
vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUser(),
  getUserOrgs: () => getUserOrgs(),
}));
vi.mock("@/lib/auth/finish-setup", () => ({
  finishAccountSetup: (...a: unknown[]) => finishAccountSetup(...a),
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
  orgsAfter.value = [];
  finishAccountSetup.mockResolvedValue({ ok: true });
});

describe("Onboarding gate", () => {
  it("sends a user who already has an org home", async () => {
    getUserOrgs.mockResolvedValue([{ id: "o1", name: "Acme" }]);

    await expect(OnboardingGate()).rejects.toThrow("REDIRECT:/");
  });

  it("sends a user home once setup created or redeemed an organisation", async () => {
    orgsAfter.value = [{ id: "o1" }];

    await expect(OnboardingGate()).rejects.toThrow("REDIRECT:/");
    expect(finishAccountSetup).toHaveBeenCalledWith(
      { id: "u1" },
      sessionClient,
    );
  });

  it("shows the form when setup ran but created nothing (no org name)", async () => {
    render(await OnboardingGate());

    expect(finishAccountSetup).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("form", { name: "Create your organization" }),
    ).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("falls through to the form when provisioning fails", async () => {
    finishAccountSetup.mockResolvedValue({ ok: false, reason: "provisioning" });
    orgsAfter.value = [{ id: "o1" }];

    render(await OnboardingGate());

    expect(
      screen.getByRole("form", { name: "Create your organization" }),
    ).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("falls through to the form when setup throws", async () => {
    finishAccountSetup.mockRejectedValue(new Error("rpc down"));

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
    expect(finishAccountSetup).not.toHaveBeenCalled();
  });
});
