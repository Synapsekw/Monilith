import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  exchangeCodeForSession,
  redeemInvitationsForUser,
  provisionAccountForUser,
} = vi.hoisted(() => ({
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
