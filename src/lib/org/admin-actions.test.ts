import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const getUser = vi.fn();
const insert = vi.fn();
const resetPasswordForEmail = vi.fn();
const memberMaybeSingle = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    auth: { getUser, resetPasswordForEmail },
    from: (table: string) =>
      table === "org_members"
        ? {
            select: () => ({
              eq: () => ({ eq: () => ({ maybeSingle: memberMaybeSingle }) }),
            }),
          }
        : { insert },
  }),
}));
const adminInvite = vi.fn();
const getUserById = vi.fn();
const svcInsert = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: { admin: { inviteUserByEmail: adminInvite, getUserById } },
    from: () => ({ insert: svcInsert }),
  }),
}));
const sendEmail = vi.fn();
vi.mock("@/lib/email/send", () => ({
  sendEmail: (m: unknown) => sendEmail(m),
}));
vi.mock("@/lib/auth/origin", () => ({
  getAppOrigin: async () => "https://app.example.com",
}));
vi.mock("@/lib/auth/session", () => ({
  getUserOrgs: async () => [
    { id: "22222222-2222-4222-8222-222222222222", name: "Acme" },
  ],
}));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: (tag: string) => updateTag(tag),
}));

import {
  setMemberRole,
  removeMember,
  deactivateMember,
  reactivateMember,
  inviteMember,
  resetMemberPassword,
} from "./admin-actions";
const uuid = "11111111-1111-4111-8111-111111111111"; // RFC-valid v4 (Zod 4.x enforces version/variant nibbles)
const orgUuid = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  adminInvite.mockReset();
  sendEmail.mockReset().mockResolvedValue("disabled");
  getUserById.mockReset();
  svcInsert.mockReset();
  resetPasswordForEmail.mockReset();
  memberMaybeSingle.mockReset();
  updateTag.mockReset();
});

describe("setMemberRole", () => {
  it("rejects invalid input before calling the RPC", async () => {
    const r = await setMemberRole({ orgId: "x", userId: uuid, role: "admin" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps the last-owner error to a friendly message", async () => {
    rpc.mockResolvedValue({
      error: { message: "cannot demote the last owner" },
    });
    const r = await setMemberRole({
      orgId: uuid,
      userId: uuid,
      role: "member",
    });
    expect(r).toEqual({
      ok: false,
      error: "Can't change the last owner's role.",
    });
  });
  it("succeeds when the RPC succeeds", async () => {
    rpc.mockResolvedValue({ error: null });
    const r = await setMemberRole({ orgId: uuid, userId: uuid, role: "admin" });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("set_member_role", {
      p_org_id: uuid,
      p_user_id: uuid,
      p_new_role: "admin",
    });
  });
});

describe("membership invalidation", () => {
  it.each([
    [
      "setMemberRole",
      () => setMemberRole({ orgId: orgUuid, userId: uuid, role: "admin" }),
    ],
    ["removeMember", () => removeMember({ orgId: orgUuid, userId: uuid })],
    [
      "deactivateMember",
      () => deactivateMember({ orgId: orgUuid, userId: uuid }),
    ],
    [
      "reactivateMember",
      () => reactivateMember({ orgId: orgUuid, userId: uuid }),
    ],
  ])("%s updates the target's org-admin tag", async (_name, run) => {
    rpc.mockResolvedValue({ error: null });
    const r = await run();
    expect(r.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith(
      `org-admin:user:${uuid}:org:${orgUuid}`,
    );
  });

  it.each([
    ["removeMember", () => removeMember({ orgId: orgUuid, userId: uuid })],
    [
      "deactivateMember",
      () => deactivateMember({ orgId: orgUuid, userId: uuid }),
    ],
    [
      "reactivateMember",
      () => reactivateMember({ orgId: orgUuid, userId: uuid }),
    ],
  ])(
    "%s invalidates the member list and the target's board caches",
    async (_name, run) => {
      rpc.mockResolvedValue({ error: null });
      const r = await run();
      expect(r.ok).toBe(true);
      expect(updateTag).toHaveBeenCalledWith(`org-members:org:${orgUuid}`);
      expect(updateTag).toHaveBeenCalledWith(`boards:user:${uuid}`);
      expect(updateTag).toHaveBeenCalledWith(`shared-boards:user:${uuid}`);
    },
  );

  it("setMemberRole invalidates the member list (the roster carries the guest flag)", async () => {
    rpc.mockResolvedValue({ error: null });
    const r = await setMemberRole({
      orgId: orgUuid,
      userId: uuid,
      role: "admin",
    });
    expect(r.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith(`org-members:org:${orgUuid}`);
  });
});

describe("inviteMember", () => {
  it("rejects when caller is unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const r = await inviteMember({
      orgId: uuid,
      email: "a@b.com",
      role: "member",
    });
    expect(r.ok).toBe(false);
  });

  it("returns emailSent:true when the invite email is delivered", async () => {
    getUser.mockResolvedValue({ data: { user: { id: uuid } } });
    insert.mockResolvedValue({ error: null }); // org_invitations insert
    adminInvite.mockResolvedValue({ error: null });
    svcInsert.mockResolvedValue({ error: null }); // audit log
    const r = await inviteMember({
      orgId: orgUuid,
      email: "a@b.com",
      role: "member",
    });
    expect(r).toEqual({ ok: true, data: { emailSent: true } });
    // The link in the invite email must land on the server-side confirm route.
    expect(adminInvite).toHaveBeenCalledWith("a@b.com", {
      redirectTo: "https://app.example.com/auth/confirm",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns emailSent:false (still ok) when email delivery fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getUser.mockResolvedValue({ data: { user: { id: uuid } } });
    insert.mockResolvedValue({ error: null });
    adminInvite.mockResolvedValue({ error: { message: "smtp unreachable" } });
    svcInsert.mockResolvedValue({ error: null });
    const r = await inviteMember({
      orgId: orgUuid,
      email: "a@b.com",
      role: "member",
    });
    expect(r).toEqual({ ok: true, data: { emailSent: false } });
    spy.mockRestore();
  });

  it("treats an 'already registered' email as delivered (emailSent:true)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: uuid } } });
    insert.mockResolvedValue({ error: null });
    adminInvite.mockResolvedValue({
      error: { message: "User already registered" },
    });
    svcInsert.mockResolvedValue({ error: null });
    const r = await inviteMember({
      orgId: orgUuid,
      email: "a@b.com",
      role: "member",
    });
    expect(r).toEqual({ ok: true, data: { emailSent: true } });
  });

  it("emails an existing account a notice naming the inviter and the org", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: uuid, email: "ann@x.com", user_metadata: {} } },
    });
    insert.mockResolvedValue({ error: null });
    adminInvite.mockResolvedValue({
      error: { message: "x", code: "email_exists" },
    });
    sendEmail.mockResolvedValue("sent");
    svcInsert.mockResolvedValue({ error: null });
    const r = await inviteMember({
      orgId: orgUuid,
      email: "a@b.com",
      role: "member",
    });
    expect(r).toEqual({ ok: true, data: { emailSent: true } });
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      to: "a@b.com",
      subject: "ann@x.com invited you to Acme",
    });
  });
});

describe("resetMemberPassword", () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: "actor" } } });
    rpc.mockResolvedValue({ data: true, error: null }); // has_org_role → allowed
    getUserById.mockResolvedValue({
      data: { user: { email: "target@example.com" } },
      error: null,
    });
    resetPasswordForEmail.mockResolvedValue({ error: null });
    svcInsert.mockResolvedValue({ error: null });
  });

  it("refuses to email a user who is NOT a member of the org", async () => {
    memberMaybeSingle.mockResolvedValue({ data: null }); // not a member
    const r = await resetMemberPassword({ orgId: orgUuid, userId: uuid });
    expect(r.ok).toBe(false);
    // Never looks the user up or sends a service-role recovery email.
    expect(getUserById).not.toHaveBeenCalled();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("sends the reset when the target belongs to the org", async () => {
    memberMaybeSingle.mockResolvedValue({ data: { user_id: uuid } });
    const r = await resetMemberPassword({ orgId: orgUuid, userId: uuid });
    expect(r.ok).toBe(true);
    expect(resetPasswordForEmail).toHaveBeenCalledWith("target@example.com");
  });

  it("still requires the caller to be an org owner/admin", async () => {
    rpc.mockResolvedValue({ data: false, error: null }); // has_org_role → denied
    const r = await resetMemberPassword({ orgId: orgUuid, userId: uuid });
    expect(r.ok).toBe(false);
    expect(memberMaybeSingle).not.toHaveBeenCalled();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
