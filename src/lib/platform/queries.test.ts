import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({}),
}));
const isPlatformAdmin = vi.fn();
vi.mock("./guard", () => ({ isPlatformAdmin: () => isPlatformAdmin() }));

import { searchUsers } from "./queries";
import { NON_CUSTOMER_EMAIL_PATTERNS } from "./test-accounts";

const row = (email: string) => ({
  id: `id-${email}`,
  email,
  banned_until: null,
  created_at: "2026-09-12T00:00:00Z",
  org_names: ["Org"],
});

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: [], error: null });
  isPlatformAdmin.mockReset().mockResolvedValue(true);
});

describe("searchUsers", () => {
  it("returns nothing and never calls the RPC for a non-admin", async () => {
    isPlatformAdmin.mockResolvedValue(false);
    expect(await searchUsers("", 25, 0, "people")).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("excludes system/test addresses server-side when listing people", async () => {
    // The bug: paginating everyone newest-first, then partitioning in the page,
    // let a burst of seeded test accounts fill page 0 and hide every real user.
    // The filter must therefore live in the query, before LIMIT/OFFSET.
    await searchUsers("", 26, 25, "people");
    expect(rpc).toHaveBeenCalledWith("platform_search_users", {
      p_query: "",
      p_limit: 26,
      p_offset: 25,
      p_exclude_email_patterns: [...NON_CUSTOMER_EMAIL_PATTERNS],
      p_only_email_patterns: undefined,
    });
  });

  it("selects only system/test addresses for the collapsed section", async () => {
    await searchUsers("fixture", 50, 0, "system");
    expect(rpc).toHaveBeenCalledWith("platform_search_users", {
      p_query: "fixture",
      p_limit: 50,
      p_offset: 0,
      p_exclude_email_patterns: undefined,
      p_only_email_patterns: [...NON_CUSTOMER_EMAIL_PATTERNS],
    });
  });

  it("applies no address filter for 'all' (the default)", async () => {
    await searchUsers("  x  ", 10, 0);
    expect(rpc).toHaveBeenCalledWith("platform_search_users", {
      p_query: "x",
      p_limit: 10,
      p_offset: 0,
      p_exclude_email_patterns: undefined,
      p_only_email_patterns: undefined,
    });
  });

  it("shapes rows into PlatformUser", async () => {
    rpc.mockResolvedValue({
      data: [{ ...row("a@eand.com"), org_names: null }],
      error: null,
    });
    expect(await searchUsers("", 25, 0, "people")).toEqual([
      {
        id: "id-a@eand.com",
        email: "a@eand.com",
        bannedUntil: null,
        orgNames: [],
      },
    ]);
  });
});
