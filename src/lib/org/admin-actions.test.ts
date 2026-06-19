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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setMemberRole, inviteMember } from "./admin-actions";
const uuid = "11111111-1111-4111-8111-111111111111"; // RFC-valid v4 (Zod 4.x enforces version/variant nibbles)

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  adminInvite.mockReset();
  svcInsert.mockReset();
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
