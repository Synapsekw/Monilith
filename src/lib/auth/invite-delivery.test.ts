import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmail, getAppOrigin } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  getAppOrigin: vi.fn(),
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: (m: unknown) => sendEmail(m),
}));
vi.mock("@/lib/auth/origin", () => ({ getAppOrigin: () => getAppOrigin() }));

import { deliverInvite } from "./invite-delivery";

const inviteUserByEmail = vi.fn();
const svc = { auth: { admin: { inviteUserByEmail } } } as never;
const CTX = {
  email: "new@x.com",
  inviterName: "Ann",
  orgName: "Acme",
  folderName: "Launch",
  scope: "test",
};

beforeEach(() => {
  inviteUserByEmail.mockReset().mockResolvedValue({ error: null });
  sendEmail.mockReset().mockResolvedValue("sent");
  getAppOrigin.mockReset().mockResolvedValue("https://app.example.com");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deliverInvite", () => {
  it("sends the Supabase invite to /auth/confirm on the app origin", async () => {
    expect(await deliverInvite(svc, CTX)).toBe("invite_email");
    expect(inviteUserByEmail).toHaveBeenCalledWith("new@x.com", {
      redirectTo: "https://app.example.com/auth/confirm",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails a notice to an address that already has an account", async () => {
    inviteUserByEmail.mockResolvedValue({
      error: { message: "whatever", code: "email_exists" },
    });
    expect(await deliverInvite(svc, CTX)).toBe("notice_email");
    const message = sendEmail.mock.calls[0][0];
    expect(message.to).toBe("new@x.com");
    expect(message.subject).toBe(
      "Ann invited you to the folder Launch in Acme",
    );
    expect(message.html).toContain("https://app.example.com/home");
  });

  it("recognises the older 'already registered' message with no code", async () => {
    inviteUserByEmail.mockResolvedValue({
      error: {
        message: "A user with this email address has already been registered",
      },
    });
    expect(await deliverInvite(svc, CTX)).toBe("notice_email");
  });

  it("degrades to in-app when email is not configured", async () => {
    inviteUserByEmail.mockResolvedValue({
      error: { message: "x", code: "email_exists" },
    });
    sendEmail.mockResolvedValue("disabled");
    expect(await deliverInvite(svc, CTX)).toBe("in_app");
  });

  it("degrades to in-app when the notice email fails", async () => {
    inviteUserByEmail.mockResolvedValue({
      error: { message: "x", code: "email_exists" },
    });
    sendEmail.mockResolvedValue("failed");
    expect(await deliverInvite(svc, CTX)).toBe("in_app");
  });

  it("reports failed for any other invite error and sends no notice", async () => {
    inviteUserByEmail.mockResolvedValue({
      error: { message: "smtp exploded", code: "unexpected_failure" },
    });
    expect(await deliverInvite(svc, CTX)).toBe("failed");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
