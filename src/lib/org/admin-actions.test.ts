import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const getUser = vi.fn();
const insert = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    auth: { getUser },
    from: () => ({ insert }),
  }),
}));
const adminInvite = vi.fn();
const svcInsert = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: { admin: { inviteUserByEmail: adminInvite } },
    from: () => ({ insert: svcInsert }),
  }),
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
} from "./admin-actions";
const uuid = "11111111-1111-4111-8111-111111111111"; // RFC-valid v4 (Zod 4.x enforces version/variant nibbles)
const orgUuid = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  adminInvite.mockReset();
  svcInsert.mockReset();
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

  it("setMemberRole does NOT invalidate the member list (payload carries no role)", async () => {
    rpc.mockResolvedValue({ error: null });
    const r = await setMemberRole({
      orgId: orgUuid,
      userId: uuid,
      role: "admin",
    });
    expect(r.ok).toBe(true);
    expect(updateTag).not.toHaveBeenCalledWith(`org-members:org:${orgUuid}`);
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
});
