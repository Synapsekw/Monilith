import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUser,
  readAccountApproval,
  finishAccountSetup,
  updateTag,
  redirect,
} = vi.hoisted(() => ({
  getUser: vi.fn(),
  readAccountApproval: vi.fn(),
  finishAccountSetup: vi.fn(),
  updateTag: vi.fn(),
  // Real redirect() throws to halt.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({ getUser: () => getUser() }));
vi.mock("@/lib/auth/approval", () => ({
  readAccountApproval: (id: string) => readAccountApproval(id),
}));
vi.mock("@/lib/auth/finish-setup", () => ({
  finishAccountSetup: (...a: unknown[]) => finishAccountSetup(...a),
}));
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));

import { checkApproval } from "./actions";

const user = { id: "u1", email: "a@b.co" };

beforeEach(() => {
  getUser.mockReset().mockResolvedValue(user);
  readAccountApproval.mockReset().mockResolvedValue("pending");
  finishAccountSetup.mockReset().mockResolvedValue({ ok: true });
  updateTag.mockReset();
  redirect.mockClear();
});

describe("checkApproval", () => {
  it("fails when not signed in and reads nothing", async () => {
    getUser.mockResolvedValue(null);
    expect(await checkApproval()).toEqual({
      ok: false,
      error: "Not authenticated.",
    });
    expect(readAccountApproval).not.toHaveBeenCalled();
  });

  it.each(["pending", "rejected"])(
    "returns ok and runs no setup while %s",
    async (status) => {
      readAccountApproval.mockResolvedValue(status);
      expect(await checkApproval()).toEqual({ ok: true, data: undefined });
      expect(readAccountApproval).toHaveBeenCalledWith("u1");
      expect(finishAccountSetup).not.toHaveBeenCalled();
      expect(updateTag).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    },
  );

  it("when approved: clears the tag, finishes setup once, redirects home", async () => {
    readAccountApproval.mockResolvedValue("approved");
    await expect(checkApproval()).rejects.toThrow("REDIRECT:/home");
    expect(updateTag).toHaveBeenCalledWith("account-approval:u1");
    expect(finishAccountSetup).toHaveBeenCalledTimes(1);
    expect(finishAccountSetup).toHaveBeenCalledWith(user);
  });

  it("returns a friendly failure and does not redirect when provisioning fails", async () => {
    readAccountApproval.mockResolvedValue("approved");
    finishAccountSetup.mockResolvedValue({ ok: false, reason: "provisioning" });
    expect(await checkApproval()).toEqual({
      ok: false,
      error: "We couldn't finish setting up your account. Please try again.",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("fails without setup when the status read fails", async () => {
    readAccountApproval.mockRejectedValue(
      new Error("Could not verify account approval."),
    );
    const r = await checkApproval();
    expect(r.ok).toBe(false);
    expect(finishAccountSetup).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
