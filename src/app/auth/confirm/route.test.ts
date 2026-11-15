import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyOtp } = vi.hoisted(() => ({ verifyOtp: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

function call(url: string) {
  return GET(new NextRequest(new URL(url, "http://localhost")));
}

beforeEach(() => {
  verifyOtp
    .mockReset()
    .mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
});

describe("GET /auth/confirm", () => {
  it("verifies the invite token hash and goes to the set-password step", async () => {
    const res = await call("/auth/confirm?token_hash=abc123&type=invite");
    expect(verifyOtp).toHaveBeenCalledWith({
      type: "invite",
      token_hash: "abc123",
    });
    expect(res.headers.get("location")).toBe(
      "http://localhost/change-password?invite=1",
    );
  });

  it("sends an expired or used link to login with an explanation", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: "Email link is invalid or has expired" },
    });
    const res = await call("/auth/confirm?token_hash=abc123&type=invite");
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?error=invite_link",
    );
  });

  it("does not continue when verification returns no user", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: null });
    const res = await call("/auth/confirm?token_hash=abc123&type=invite");
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?error=invite_link",
    );
  });

  it("refuses a link with no token hash without calling Supabase", async () => {
    const res = await call("/auth/confirm?type=invite");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?error=invite_link",
    );
  });

  it.each(["recovery", "signup", "magiclink", "email", ""])(
    "refuses type=%s (only invitations land here)",
    async (type) => {
      const res = await call(`/auth/confirm?token_hash=abc123&type=${type}`);
      expect(verifyOtp).not.toHaveBeenCalled();
      expect(res.headers.get("location")).toBe(
        "http://localhost/login?error=invite_link",
      );
    },
  );

  it("ignores a next parameter (no open redirect surface)", async () => {
    const res = await call(
      "/auth/confirm?token_hash=abc123&type=invite&next=https%3A%2F%2Fevil.com",
    );
    expect(res.headers.get("location")).toBe(
      "http://localhost/change-password?invite=1",
    );
  });
});
