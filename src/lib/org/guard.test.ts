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

import { isOrgAdmin } from "@/lib/org/guard";

beforeEach(() => {
  getUser.mockReset();
  getUserOrgs.mockReset();
  rpc.mockReset();
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
