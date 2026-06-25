import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const getUserOrgs = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getUser: () => getUser(),
  getUserOrgs: () => getUserOrgs(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));

// cacheTag/cacheLife throw outside a compiled `use cache` scope under Vitest.
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

// Service client for the cached guard: from().select().eq().eq().maybeSingle().
const maybeSingle = vi.fn();
const eq2 = vi.fn(() => ({ maybeSingle }));
const eq1 = vi.fn(() => ({ eq: eq2 }));
const select = vi.fn(() => ({ eq: eq1 }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));

import { isOrgAdmin, isOrgAdminCached } from "@/lib/org/guard";

beforeEach(() => {
  getUser.mockReset();
  getUserOrgs.mockReset();
  rpc.mockReset();
  from.mockClear();
  select.mockClear();
  eq1.mockClear();
  eq2.mockClear();
  maybeSingle.mockReset();
});

describe("isOrgAdmin", () => {
  it("returns true when the current user is an owner", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    getUserOrgs.mockResolvedValue([{ id: "org1", name: "Acme" }]);
    rpc.mockResolvedValue({
      data: [{ user_id: "u1", role: "owner" }],
      error: null,
    });
    expect(await isOrgAdmin()).toBe(true);
  });

  it("returns false for a plain member", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    getUserOrgs.mockResolvedValue([{ id: "org1", name: "Acme" }]);
    rpc.mockResolvedValue({
      data: [{ user_id: "u1", role: "member" }],
      error: null,
    });
    expect(await isOrgAdmin()).toBe(false);
  });

  it("fails closed (false) when there is no user or org", async () => {
    getUser.mockResolvedValue(null);
    getUserOrgs.mockResolvedValue([]);
    expect(await isOrgAdmin()).toBe(false);
  });

  it("fails closed when the RPC errors", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    getUserOrgs.mockResolvedValue([{ id: "org1", name: "Acme" }]);
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await isOrgAdmin()).toBe(false);
  });
});

describe("isOrgAdminCached", () => {
  it("is true when the member row's role is owner", async () => {
    maybeSingle.mockResolvedValue({ data: { role: "owner" }, error: null });
    expect(await isOrgAdminCached("u1", "org1")).toBe(true);
    expect(from).toHaveBeenCalledWith("org_members");
    expect(eq1).toHaveBeenCalledWith("org_id", "org1");
    expect(eq2).toHaveBeenCalledWith("user_id", "u1");
  });

  it("is true when the member row's role is admin", async () => {
    maybeSingle.mockResolvedValue({ data: { role: "admin" }, error: null });
    expect(await isOrgAdminCached("u1", "org1")).toBe(true);
  });

  it("is false for a plain member", async () => {
    maybeSingle.mockResolvedValue({ data: { role: "member" }, error: null });
    expect(await isOrgAdminCached("u1", "org1")).toBe(false);
  });

  it("fails closed (false) on error", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await isOrgAdminCached("u1", "org1")).toBe(false);
  });
});
