import { describe, it, expect, vi, beforeEach } from "vitest";

// Well-formed v4 UUIDs — Zod's .uuid() checks the version and variant nibbles,
// so "1111…-1111-1111…" is rejected as invalid, not just as a shape mismatch.
const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

type Member = { user_id: string; role: string };

const h = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    updateError: null as { message: string } | null,
    deleteError: null as { message: string } | null,
    rpcData: [] as Member[],
    rpcError: null as { message: string } | null,
  };
  const updateSpy = vi.fn();
  const deleteSpy = vi.fn();
  return { state, updateSpy, deleteSpy };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        h.updateSpy(table, values);
        return { eq: async () => ({ error: h.state.updateError }) };
      },
      delete: () => ({
        eq: () => ({
          eq: async () => {
            h.deleteSpy(table);
            return { error: h.state.deleteError };
          },
        }),
      }),
    }),
    rpc: async () => ({ data: h.state.rpcData, error: h.state.rpcError }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateOrgName, leaveOrg } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  h.state.user = { id: USER };
  h.state.updateError = null;
  h.state.deleteError = null;
  h.state.rpcData = [];
  h.state.rpcError = null;
});

describe("updateOrgName", () => {
  it("rejects a blank name before touching the database", async () => {
    const res = await updateOrgName({ orgId: ORG, name: "   " });
    expect(res.ok).toBe(false);
    expect(h.updateSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid orgId", async () => {
    const res = await updateOrgName({ orgId: "nope", name: "Acme" });
    expect(res.ok).toBe(false);
    expect(h.updateSpy).not.toHaveBeenCalled();
  });

  it("trims and writes a valid name", async () => {
    const res = await updateOrgName({ orgId: ORG, name: "  Acme Inc  " });
    expect(res.ok).toBe(true);
    expect(h.updateSpy).toHaveBeenCalledWith("organizations", {
      name: "Acme Inc",
    });
  });

  it("fails when there is no authenticated user", async () => {
    h.state.user = null;
    const res = await updateOrgName({ orgId: ORG, name: "Acme" });
    expect(res.ok).toBe(false);
    expect(h.updateSpy).not.toHaveBeenCalled();
  });

  it("reports a failure when RLS denies the write", async () => {
    h.state.updateError = { message: "permission denied" };
    const res = await updateOrgName({ orgId: ORG, name: "Acme" });
    expect(res.ok).toBe(false);
  });
});

describe("leaveOrg", () => {
  it("refuses when the caller is the only owner", async () => {
    h.state.rpcData = [{ user_id: USER, role: "owner" }];
    const res = await leaveOrg({ orgId: ORG });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/only owner/i);
    expect(h.deleteSpy).not.toHaveBeenCalled();
  });

  it("allows leaving when another owner remains", async () => {
    h.state.rpcData = [
      { user_id: USER, role: "owner" },
      { user_id: "other", role: "owner" },
    ];
    const res = await leaveOrg({ orgId: ORG });
    expect(res.ok).toBe(true);
    expect(h.deleteSpy).toHaveBeenCalledWith("org_members");
  });

  it("allows a plain member to leave even with one owner", async () => {
    h.state.rpcData = [
      { user_id: USER, role: "member" },
      { user_id: "other", role: "owner" },
    ];
    const res = await leaveOrg({ orgId: ORG });
    expect(res.ok).toBe(true);
    expect(h.deleteSpy).toHaveBeenCalledWith("org_members");
  });

  it("refuses when the caller is not a member", async () => {
    h.state.rpcData = [{ user_id: "other", role: "owner" }];
    const res = await leaveOrg({ orgId: ORG });
    expect(res.ok).toBe(false);
    expect(h.deleteSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid orgId", async () => {
    const res = await leaveOrg({ orgId: "nope" });
    expect(res.ok).toBe(false);
  });
});
