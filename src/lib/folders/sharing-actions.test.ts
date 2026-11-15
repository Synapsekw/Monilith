import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));

const rpc = vi.fn();
const fromResult: { data: unknown; error: unknown } = {
  data: { id: "f1", org_id: "o1" },
  error: null,
};
const deleteEq = vi.fn();
const deleted: { rows: unknown[] } = { rows: [{ user_id: "me" }] };
const membersResult: { data: unknown; error: unknown } = {
  data: [],
  error: null,
};
const roster = [
  { userId: "u-me", fullName: "Me", email: "me@x.com", avatarUrl: null },
  { userId: "u-a", fullName: "Ann", email: "ann@x.com", avatarUrl: "a.png" },
  { userId: "u-b", fullName: "Bob", email: "bob@x.com", avatarUrl: null },
];
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: vi.fn(async () => roster),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === "folder_members"
            ? { order: () => ({ limit: async () => membersResult }) }
            : { maybeSingle: async () => fromResult },
      }),
      delete: () => ({
        eq: (c1: string, v1: unknown) => ({
          eq: (c2: string, v2: unknown) => {
            deleteEq(c1, v1, c2, v2);
            // RETURNING: how many rows the delete actually removed.
            return {
              select: async () => ({ data: deleted.rows, error: null }),
            };
          },
        }),
      }),
    }),
  })),
}));

const inviteUserByEmail = vi.fn();
const auditInsert = vi.fn(async (_row: unknown) => ({ error: null }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    auth: { admin: { inviteUserByEmail: (e: string) => inviteUserByEmail(e) } },
    from: () => ({ insert: auditInsert }),
  })),
}));

import {
  inviteToFolder,
  loadFolderAccess,
  leaveFolder,
  revokeFolderInvitation,
  shareFolder,
  unshareFolder,
} from "./sharing-actions";

const F = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const I = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  updateTag.mockReset();
  rpc.mockReset();
  inviteUserByEmail.mockReset();
  auditInsert.mockClear();
  deleteEq.mockReset();
  deleted.rows = [{ user_id: "me" }];
  membersResult.data = [];
});

describe("shareFolder", () => {
  it("rejects a malformed id without calling the database", async () => {
    const r = await shareFolder({
      folderId: "nope",
      userId: U,
      level: "viewer",
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("calls share_folder and invalidates the grantee's lists", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await shareFolder({ folderId: F, userId: U, level: "editor" });
    expect(r).toEqual({ ok: true, data: undefined });
    expect(rpc).toHaveBeenCalledWith("share_folder", {
      p_folder_id: F,
      p_user_id: U,
      p_level: "editor",
    });
    expect(updateTag).toHaveBeenCalledWith(`shared-boards:user:${U}`);
    expect(updateTag).toHaveBeenCalledWith(`folder-members:user:${U}`);
  });
  it("maps the permission error to the spec's copy and invalidates nothing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "not allowed to manage this folder", code: "42501" },
    });
    const r = await shareFolder({ folderId: F, userId: U, level: "viewer" });
    expect(r).toEqual({
      ok: false,
      error: "Only the folder's creator or an admin can invite people",
    });
    expect(updateTag).not.toHaveBeenCalled();
  });
  it("maps a duplicate grant to 'already has access'", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "duplicate key value", code: "23505" },
    });
    const r = await shareFolder({ folderId: F, userId: U, level: "viewer" });
    expect(r).toEqual({ ok: false, error: "That person already has access" });
  });
});

describe("unshareFolder", () => {
  it("calls unshare_folder and invalidates the removed person's lists", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await unshareFolder({ folderId: F, userId: U });
    expect(rpc).toHaveBeenCalledWith("unshare_folder", {
      p_folder_id: F,
      p_user_id: U,
    });
    expect(updateTag).toHaveBeenCalledWith(`shared-boards:user:${U}`);
  });
});

describe("inviteToFolder", () => {
  it("rejects a bad email with the spec's copy", async () => {
    const r = await inviteToFolder({
      folderId: F,
      email: "nope",
      level: "viewer",
    });
    expect(r).toEqual({ ok: false, error: "Enter a valid email address" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reports 'shared' and sends no email when the address is already an org member", async () => {
    rpc.mockResolvedValue({ data: U, error: null });
    const r = await inviteToFolder({
      folderId: F,
      email: "A@x.com",
      level: "viewer",
    });
    expect(rpc).toHaveBeenCalledWith("invite_to_folder", {
      p_folder_id: F,
      p_email: "a@x.com",
      p_level: "viewer",
    });
    expect(r).toEqual({ ok: true, data: { kind: "shared" } });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(updateTag).toHaveBeenCalledWith(`shared-boards:user:${U}`);
  });
  it("sends the invite email for an outside address and reports it sent", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    inviteUserByEmail.mockResolvedValue({ error: null });
    const r = await inviteToFolder({
      folderId: F,
      email: "new@x.com",
      level: "editor",
    });
    expect(inviteUserByEmail).toHaveBeenCalledWith("new@x.com");
    expect(r).toEqual({ ok: true, data: { kind: "invited", emailSent: true } });
    expect(auditInsert).toHaveBeenCalledTimes(1);
  });
  it("returns the identical result for an address with an account elsewhere and one with none", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    inviteUserByEmail.mockResolvedValueOnce({ error: null });
    const none = await inviteToFolder({
      folderId: F,
      email: "new@x.com",
      level: "viewer",
    });
    inviteUserByEmail.mockResolvedValueOnce({
      error: {
        message: "A user with this email address has already been registered",
      },
    });
    const elsewhere = await inviteToFolder({
      folderId: F,
      email: "old@x.com",
      level: "viewer",
    });
    expect(elsewhere).toEqual(none);
    expect(elsewhere).toEqual({
      ok: true,
      data: { kind: "invited", emailSent: true },
    });
  });
  it("reports emailSent false on a genuine delivery error, still records the audit row", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: null });
    inviteUserByEmail.mockResolvedValue({
      error: { message: "SMTP provider timed out" },
    });
    const r = await inviteToFolder({
      folderId: F,
      email: "new@x.com",
      level: "viewer",
    });
    expect(r).toEqual({
      ok: true,
      data: { kind: "invited", emailSent: false },
    });
    // The invitation was recorded by the RPC before the email was attempted.
    expect(rpc).toHaveBeenCalledWith("invite_to_folder", expect.anything());
    expect(auditInsert).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  it("writes the audit row with actor, org, action and target", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    inviteUserByEmail.mockResolvedValue({ error: null });
    await inviteToFolder({ folderId: F, email: "New@x.com", level: "editor" });
    expect(auditInsert).toHaveBeenCalledWith({
      org_id: "o1",
      actor_id: "me",
      actor_kind: "org",
      action: "folder.invited",
      target_email: "new@x.com",
      metadata: { folderId: F, level: "editor" },
    });
  });
  it("rejects an email over 254 characters without calling the database", async () => {
    const r = await inviteToFolder({
      folderId: F,
      email: `${"a".repeat(250)}@x.com`,
      level: "viewer",
    });
    expect(r).toEqual({ ok: false, error: "Enter a valid email address" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps the message from invite_to_folder for a current member to 'already has access'", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "already has access", code: "23505" },
    });
    const r = await inviteToFolder({
      folderId: F,
      email: "ann@x.com",
      level: "viewer",
    });
    expect(r).toEqual({ ok: false, error: "That person already has access" });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });
  it("sends no email and writes no audit row when the permission check fails", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "not allowed to manage this folder", code: "42501" },
    });
    const r = await inviteToFolder({
      folderId: F,
      email: "new@x.com",
      level: "viewer",
    });
    expect(r).toEqual({
      ok: false,
      error: "Only the folder's creator or an admin can invite people",
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });
});

describe("revokeFolderInvitation", () => {
  it("calls revoke_folder_invitation", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await revokeFolderInvitation({ folderId: F, invitationId: I });
    expect(rpc).toHaveBeenCalledWith("revoke_folder_invitation", { p_id: I });
    expect(r.ok).toBe(true);
  });
});

describe("leaveFolder", () => {
  it("deletes only the caller's own row and invalidates their lists", async () => {
    const r = await leaveFolder({ folderId: F });
    expect(deleteEq).toHaveBeenCalledWith("folder_id", F, "user_id", "me");
    expect(updateTag).toHaveBeenCalledWith("shared-boards:user:me");
    expect(r.ok).toBe(true);
  });
  it("never invalidates the folders tag for a membership change", async () => {
    await leaveFolder({ folderId: F });
    for (const [tag] of updateTag.mock.calls)
      expect(String(tag)).not.toMatch(/^folders:/);
  });
  it("does not report success when the caller was not on the folder", async () => {
    deleted.rows = [];
    const r = await leaveFolder({ folderId: F });
    expect(r).toEqual({
      ok: false,
      error: "You are not a member of this folder",
    });
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("error mapping", () => {
  const cases: [string, { message: string; code?: string }, string][] = [
    [
      "invalid email (22023)",
      { message: "invalid email", code: "22023" },
      "Enter a valid email address",
    ],
    [
      "invitation not found (P0002)",
      { message: "invitation not found", code: "P0002" },
      "That invitation is no longer pending.",
    ],
    [
      "target not in org",
      { message: "target is not a member of this org", code: "42501" },
      "That person isn't in your organization yet.",
    ],
    [
      "a Mono target",
      { message: "a Mono follows its owner", code: "42501" },
      "A Mono gets access through its owner.",
    ],
    [
      "not a manager",
      { message: "not allowed to manage this folder", code: "42501" },
      "Only the folder's creator or an admin can invite people",
    ],
    [
      "unknown error never leaks the raw message",
      { message: 'relation "folder_members" is locked by pid 4242' },
      "Something went wrong. Please try again.",
    ],
  ];
  it.each(cases)("%s", async (_name, error, copy) => {
    rpc.mockResolvedValue({ data: null, error });
    const r = await shareFolder({ folderId: F, userId: U, level: "viewer" });
    expect(r).toEqual({ ok: false, error: copy });
    const r2 = await revokeFolderInvitation({ folderId: F, invitationId: I });
    expect(r2).toEqual({ ok: false, error: copy });
  });
});

describe("loadFolderAccess", () => {
  const states = [
    { id: I, email: "pend@x.com", access_level: "viewer", state: "invited" },
  ];
  function wire(canManage: boolean) {
    membersResult.data = [{ user_id: "u-a", access_level: "editor" }];
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "can_manage_folder") return { data: canManage, error: null };
      if (fn === "folder_invitation_states")
        return { data: states, error: null };
      return { data: null, error: null };
    });
  }

  it("gives a manager invitations and candidates, and no emails in member entries", async () => {
    wire(true);
    const r = await loadFolderAccess({ folderId: F });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.canManage).toBe(true);
    expect(r.data.invitations).toEqual([
      { id: I, email: "pend@x.com", level: "viewer", state: "invited" },
    ]);
    expect(r.data.candidates.map((c) => c.userId).sort()).toEqual([
      "u-b",
      "u-me",
    ]);
    expect(r.data.members).toEqual([
      { userId: "u-a", fullName: "Ann", avatarUrl: "a.png", level: "editor" },
    ]);
    expect(JSON.stringify(r.data.members)).not.toContain("@");
    expect(JSON.stringify(r.data.candidates)).not.toContain("@");
    expect(r.data.membersTruncated).toBe(false);
  });

  it("gives a non-manager no invitations and no candidates, and never asks for them", async () => {
    wire(false);
    const r = await loadFolderAccess({ folderId: F });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.canManage).toBe(false);
    expect(r.data.invitations).toEqual([]);
    expect(r.data.candidates).toEqual([]);
    expect(rpc).not.toHaveBeenCalledWith(
      "folder_invitation_states",
      expect.anything(),
    );
  });

  it("flags a member list cut at the read limit", async () => {
    wire(true);
    membersResult.data = Array.from({ length: 200 }, (_, i) => ({
      user_id: `x${i}`,
      access_level: "viewer",
    }));
    const r = await loadFolderAccess({ folderId: F });
    expect(r.ok && r.data.membersTruncated).toBe(true);
  });

  it("reports a folder the caller cannot see as gone", async () => {
    wire(false);
    fromResult.data = null;
    const r = await loadFolderAccess({ folderId: F });
    fromResult.data = { id: "f1", org_id: "o1" };
    expect(r).toEqual({ ok: false, error: "That folder no longer exists." });
  });
});
