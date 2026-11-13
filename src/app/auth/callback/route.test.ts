import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  exchangeCodeForSession,
  redeemInvitationsForUser,
  provisionAccountForUser,
  resolveAccountApproval,
} = vi.hoisted(() => ({
  resolveAccountApproval: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  redeemInvitationsForUser: vi.fn(),
  provisionAccountForUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));
vi.mock("@/lib/auth/provision", () => ({
  provisionAccountForUser: (...a: unknown[]) => provisionAccountForUser(...a),
}));
vi.mock("@/lib/auth/redeem", () => ({
  redeemInvitationsForUser: (...a: unknown[]) => redeemInvitationsForUser(...a),
}));

// The approval read (service client + `use cache`) is unit-tested in
// src/lib/auth/approval.test.ts; drive only its status here.
vi.mock("@/lib/auth/approval", () => ({
  PENDING_APPROVAL_PATH: "/pending-approval",
  resolveAccountApproval: (...a: unknown[]) => resolveAccountApproval(...a),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const LF = "\n";

function call(url: string) {
  return GET(new NextRequest(new URL(url, "http://localhost")));
}

beforeEach(() => {
  exchangeCodeForSession.mockReset().mockResolvedValue({
    data: { user: { id: "u1" } },
    error: null,
  });
  redeemInvitationsForUser.mockReset().mockResolvedValue(1);
  provisionAccountForUser.mockReset().mockResolvedValue({ error: null });
  resolveAccountApproval.mockReset().mockResolvedValue("approved");
});

describe("GET /auth/callback — next handling", () => {
  it("redirects to a safe next", async () => {
    const res = await call("/auth/callback?next=%2Fboards%2Fb1");
    expect(res.headers.get("location")).toBe("http://localhost/boards/b1");
  });

  it("falls back to / with no next", async () => {
    const res = await call("/auth/callback");
    expect(res.headers.get("location")).toBe("http://localhost/");
  });

  it("refuses the control-character open redirect", async () => {
    // Encoded form of "/" + LF + "/evil.com" — resolves off-site unsanitized.
    const res = await call("/auth/callback?next=%2F%0A%2Fevil.com");
    expect(res.headers.get("location")).toBe("http://localhost/");
    expect(encodeURIComponent("/" + LF + "/evil.com")).toBe(
      "%2F%0A%2Fevil.com",
    );
  });

  it("refuses an absolute next", async () => {
    const res = await call("/auth/callback?next=https%3A%2F%2Fevil.com");
    expect(res.headers.get("location")).toBe("http://localhost/");
  });

  it("keeps next on the provisioning-failure bounce so the user can resume", async () => {
    redeemInvitationsForUser.mockResolvedValue(0);
    provisionAccountForUser.mockResolvedValue({ error: new Error("boom") });

    const res = await call("/auth/callback?code=abc&next=%2Fboards%2Fb1");

    expect(res.headers.get("location")).toBe(
      "http://localhost/login?error=provisioning&next=%2Fboards%2Fb1",
    );
  });

  it("drops an unsafe next from the provisioning-failure bounce", async () => {
    redeemInvitationsForUser.mockResolvedValue(0);
    provisionAccountForUser.mockResolvedValue({ error: new Error("boom") });

    const res = await call("/auth/callback?code=abc&next=%2F%2Fevil.com");

    expect(res.headers.get("location")).toBe(
      "http://localhost/login?error=provisioning",
    );
  });
});

describe("GET /auth/callback — account approval", () => {
  it.each(["pending", "rejected"] as const)(
    "sends a %s account to the waiting screen and runs no setup",
    async (status) => {
      resolveAccountApproval.mockResolvedValue(status);

      const res = await call("/auth/callback?code=abc&next=%2Fboards%2Fb1");

      expect(resolveAccountApproval).toHaveBeenCalledWith("u1");
      expect(res.headers.get("location")).toBe(
        "http://localhost/pending-approval",
      );
      expect(redeemInvitationsForUser).not.toHaveBeenCalled();
      expect(provisionAccountForUser).not.toHaveBeenCalled();
    },
  );

  it("runs setup when the cached status was pending but the live one is approved", async () => {
    // resolveAccountApproval is the cached-then-live rule; the route must use
    // it (not the raw cached read) so a just-approved account is not bounced.
    resolveAccountApproval.mockResolvedValue("approved");
    redeemInvitationsForUser.mockResolvedValue(0);

    const res = await call("/auth/callback?code=abc&next=%2Fboards%2Fb1");

    expect(resolveAccountApproval).toHaveBeenCalledWith("u1");
    expect(redeemInvitationsForUser).toHaveBeenCalledTimes(1);
    expect(res.headers.get("location")).toBe("http://localhost/boards/b1");
  });

  it.each(["pending", "rejected"] as const)(
    "lets a %s account through to a password-recovery link, with no setup",
    async (status) => {
      resolveAccountApproval.mockResolvedValue(status);

      const res = await call(
        "/auth/callback?code=abc&next=" +
          encodeURIComponent("/change-password?recovery=1"),
      );

      expect(res.headers.get("location")).toBe(
        "http://localhost/change-password?recovery=1",
      );
      expect(redeemInvitationsForUser).not.toHaveBeenCalled();
      expect(provisionAccountForUser).not.toHaveBeenCalled();
    },
  );

  it("does not treat a look-alike path as a recovery link", async () => {
    resolveAccountApproval.mockResolvedValue("pending");

    const res = await call(
      "/auth/callback?code=abc&next=" + encodeURIComponent("/change-passwordx"),
    );

    expect(res.headers.get("location")).toBe(
      "http://localhost/pending-approval",
    );
  });

  it("still sends an unapproved account with a hostile next to the waiting screen", async () => {
    resolveAccountApproval.mockResolvedValue("pending");

    const res = await call("/auth/callback?code=abc&next=%2F%2Fevil.com");

    expect(res.headers.get("location")).toBe(
      "http://localhost/pending-approval",
    );
  });

  it("runs setup for an approved account and resumes next", async () => {
    redeemInvitationsForUser.mockResolvedValue(0);

    const res = await call("/auth/callback?code=abc&next=%2Fboards%2Fb1");

    expect(redeemInvitationsForUser).toHaveBeenCalledTimes(1);
    expect(provisionAccountForUser).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.anything() }),
      { id: "u1" },
    );
    expect(res.headers.get("location")).toBe("http://localhost/boards/b1");
  });

  it("skips provisioning when an invitation was redeemed", async () => {
    redeemInvitationsForUser.mockResolvedValue(1);

    await call("/auth/callback?code=abc");

    expect(provisionAccountForUser).not.toHaveBeenCalled();
  });

  it("bounces to the login error on a failed status read and runs no setup", async () => {
    resolveAccountApproval.mockRejectedValue(
      new Error("Could not verify account approval."),
    );

    const res = await call("/auth/callback?code=abc&next=%2Fboards%2Fb1");

    expect(res.headers.get("location")).toBe(
      "http://localhost/login?error=provisioning&next=%2Fboards%2Fb1",
    );
    expect(redeemInvitationsForUser).not.toHaveBeenCalled();
    expect(provisionAccountForUser).not.toHaveBeenCalled();
  });

  it("never reads the status when the code exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: new Error("bad code"),
    });

    await call("/auth/callback?code=abc");

    expect(resolveAccountApproval).not.toHaveBeenCalled();
  });
});
