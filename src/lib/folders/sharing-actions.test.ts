import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));

const rpc = vi.fn();
const fromResult: { data: unknown; error: unknown } = {
  data: { id: "f1", org_id: "o1" },
  error: null,
};
const deleteEq = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => fromResult }),
      }),
      delete: () => ({
        eq: (c1: string, v1: unknown) => ({
          eq: async (c2: string, v2: unknown) => {
            deleteEq(c1, v1, c2, v2);
            return { error: null };
          },
        }),
      }),
    }),
  })),
}));

const inviteUserByEmail = vi.fn();
const auditInsert = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    auth: { admin: { inviteUserByEmail: (e: string) => inviteUserByEmail(e) } },
    from: () => ({ insert: auditInsert }),
  })),
}));

import {
  inviteToFolder,
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
  it("reports emailSent false when the address already has an account", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    inviteUserByEmail.mockResolvedValue({
      error: {
        message: "A user with this email address has already been registered",
      },
    });
    const r = await inviteToFolder({
      folderId: F,
      email: "old@x.com",
      level: "viewer",
    });
    expect(r).toEqual({
      ok: true,
      data: { kind: "invited", emailSent: false },
    });
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
});
