import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const getUser = vi.fn();
const resetPasswordForEmail = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    auth: { getUser, resetPasswordForEmail },
  }),
}));

const getUserById = vi.fn();
const updateUserById = vi.fn();
const deleteUser = vi.fn();
const svcInsert = vi.fn();
const svcUpsert = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: { admin: { getUserById, updateUserById, deleteUser } },
    from: () => ({ insert: svcInsert, upsert: svcUpsert }),
  }),
}));

const isPlatformAdmin = vi.fn();
vi.mock("./guard", () => ({ isPlatformAdmin: () => isPlatformAdmin() }));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: (tag: string) => updateTag(tag),
}));

import {
  platformResetUserPassword,
  platformSetUserPassword,
  platformDeleteUser,
  platformSetOrgRole,
  setOrgAiPlan,
} from "./actions";

const actor = "00000000-0000-4000-8000-000000000000";
const target = "11111111-1111-4111-8111-111111111111";
const orgUuid = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: actor } } });
  resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  getUserById.mockReset().mockResolvedValue({
    data: {
      user: { id: target, email: "t@example.com", app_metadata: { x: 1 } },
    },
    error: null,
  });
  updateUserById
    .mockReset()
    .mockResolvedValue({ data: { user: {} }, error: null });
  deleteUser.mockReset().mockResolvedValue({ error: null });
  svcInsert.mockReset().mockResolvedValue({ error: null });
  svcUpsert.mockReset().mockResolvedValue({ error: null });
  isPlatformAdmin.mockReset().mockResolvedValue(true);
  updateTag.mockReset();
});

describe("platformSetOrgRole", () => {
  it("updates the target's org-admin tag on success", async () => {
    rpc.mockResolvedValue({ error: null });
    const r = await platformSetOrgRole({
      orgId: orgUuid,
      userId: target,
      role: "admin",
    });
    expect(r.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith(
      `org-admin:user:${target}:org:${orgUuid}`,
    );
  });
});

describe("authorization", () => {
  it("rejects a non-admin caller", async () => {
    isPlatformAdmin.mockResolvedValue(false);
    const r = await platformResetUserPassword({ userId: target });
    expect(r.ok).toBe(false);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("platformResetUserPassword", () => {
  it("sends the reset email and audits", async () => {
    const r = await platformResetUserPassword({ userId: target });
    expect(r.ok).toBe(true);
    expect(resetPasswordForEmail).toHaveBeenCalledWith("t@example.com");
    expect(svcInsert).toHaveBeenCalled();
  });
});

describe("platformSetUserPassword", () => {
  it("rejects a too-short password before any service call", async () => {
    const r = await platformSetUserPassword({
      userId: target,
      password: "short",
    });
    expect(r.ok).toBe(false);
    expect(updateUserById).not.toHaveBeenCalled();
  });
  it("sets the password and flags must_change_password, preserving metadata", async () => {
    const r = await platformSetUserPassword({
      userId: target,
      password: "longenough1",
    });
    expect(r.ok).toBe(true);
    expect(updateUserById).toHaveBeenCalledWith(target, {
      password: "longenough1",
      app_metadata: { x: 1, must_change_password: true },
    });
  });
});

describe("setOrgAiPlan", () => {
  it("rejects a non-admin caller without upserting", async () => {
    isPlatformAdmin.mockResolvedValue(false);
    const r = await setOrgAiPlan({
      orgId: orgUuid,
      tier: "pulse",
      monthlyCreditLimit: 5000,
    });
    expect(r.ok).toBe(false);
    expect(svcUpsert).not.toHaveBeenCalled();
  });

  it("upserts the entitlements for a platform admin (mode untouched)", async () => {
    const r = await setOrgAiPlan({
      orgId: orgUuid,
      tier: "pulse",
      monthlyCreditLimit: 5000,
    });
    expect(r.ok).toBe(true);
    expect(svcUpsert).toHaveBeenCalledWith(
      {
        org_id: orgUuid,
        tier: "pulse",
        monthly_credit_limit: 5000,
        updated_by: actor,
      },
      { onConflict: "org_id" },
    );
  });

  it("rejects an invalid tier without upserting", async () => {
    const r = await setOrgAiPlan({
      orgId: orgUuid,
      tier: "unlimited",
      monthlyCreditLimit: 5000,
    });
    expect(r.ok).toBe(false);
    expect(svcUpsert).not.toHaveBeenCalled();
  });
});

describe("platformDeleteUser", () => {
  it("blocks when the user is the sole owner of an org", async () => {
    rpc.mockResolvedValue({
      data: [{ org_id: "o1", org_name: "Acme" }],
      error: null,
    });
    const r = await platformDeleteUser({ userId: target });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Acme");
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("deletes when no sole-owned orgs, auditing before deletion", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const r = await platformDeleteUser({ userId: target });
    expect(r.ok).toBe(true);
    expect(svcInsert).toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith(target);
  });
  it("refuses self-deletion", async () => {
    const r = await platformDeleteUser({ userId: actor });
    expect(r.ok).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
