import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));

/**
 * Service-client fake for the pending count: an in-memory `account_approvals`
 * that records every query and APPLIES its `.eq` filters before counting, so a
 * count that forgot the status filter would return the wrong number.
 */
const { approvals, svcCalls } = vi.hoisted(() => ({
  approvals: { rows: [] as { user_id: string; status: string }[] },
  svcCalls: [] as unknown[][],
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      svcCalls.push(["from", table]);
      const filters: [string, unknown][] = [];
      const q = {
        select: (cols: string, opts: unknown) => {
          svcCalls.push(["select", cols, opts]);
          return q;
        },
        eq: (col: string, val: unknown) => {
          svcCalls.push(["eq", col, val]);
          filters.push([col, val]);
          return q;
        },
        then: (resolve: (v: unknown) => void) => {
          const rows = approvals.rows.filter((r) =>
            filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v),
          );
          resolve({ data: null, count: rows.length, error: null });
        },
      };
      return q;
    },
  }),
}));
const isPlatformAdmin = vi.fn();
vi.mock("./guard", () => ({ isPlatformAdmin: () => isPlatformAdmin() }));

import {
  countPendingAccounts,
  listPendingAccounts,
  searchUsers,
} from "./queries";
import { NON_CUSTOMER_EMAIL_PATTERNS } from "./test-accounts";

const row = (email: string) => ({
  id: `id-${email}`,
  email,
  banned_until: null,
  created_at: "2026-09-12T00:00:00Z",
  org_names: ["Org"],
  approval_status: "approved",
});

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: [], error: null });
  isPlatformAdmin.mockReset().mockResolvedValue(true);
  approvals.rows = [];
  svcCalls.length = 0;
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
        approvalStatus: "approved",
        createdAt: "2026-09-12T00:00:00Z",
      },
    ]);
  });

  it("maps each approval status", async () => {
    rpc.mockResolvedValue({
      data: [
        { ...row("p@eand.com"), approval_status: "pending" },
        { ...row("r@eand.com"), approval_status: "rejected" },
      ],
      error: null,
    });
    const users = await searchUsers("", 25, 0, "people");
    expect(users.map((u) => u.approvalStatus)).toEqual(["pending", "rejected"]);
  });
});

describe("listPendingAccounts", () => {
  it("returns nothing and never calls the RPC for a non-admin", async () => {
    isPlatformAdmin.mockResolvedValue(false);
    expect(await listPendingAccounts()).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks the RPC for pending accounts only, bounded, with no address filter", async () => {
    // A pending fixture-looking address still needs a decision, so neither
    // email-pattern argument is passed.
    await listPendingAccounts();
    expect(rpc).toHaveBeenCalledWith("platform_search_users", {
      p_query: "",
      p_limit: 50,
      p_offset: 0,
      p_only_status: "pending",
    });
  });

  it("honours a custom limit and shapes rows", async () => {
    rpc.mockResolvedValue({
      data: [{ ...row("probe@example.com"), approval_status: "pending" }],
      error: null,
    });
    const users = await listPendingAccounts(10);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_limit: 10 });
    expect(users).toEqual([
      {
        id: "id-probe@example.com",
        email: "probe@example.com",
        bannedUntil: null,
        orgNames: ["Org"],
        approvalStatus: "pending",
        createdAt: "2026-09-12T00:00:00Z",
      },
    ]);
  });
});

describe("countPendingAccounts", () => {
  it("returns 0 and never touches the service client for a non-admin", async () => {
    isPlatformAdmin.mockResolvedValue(false);
    approvals.rows = [{ user_id: "a", status: "pending" }];
    expect(await countPendingAccounts()).toBe(0);
    expect(svcCalls).toEqual([]);
  });

  it("counts only pending rows with a head-only exact count", async () => {
    approvals.rows = [
      { user_id: "a", status: "pending" },
      { user_id: "b", status: "approved" },
      { user_id: "c", status: "pending" },
      { user_id: "d", status: "rejected" },
    ];
    expect(await countPendingAccounts()).toBe(2);
    expect(svcCalls).toContainEqual(["from", "account_approvals"]);
    expect(svcCalls).toContainEqual([
      "select",
      "user_id",
      { count: "exact", head: true },
    ]);
    expect(svcCalls).toContainEqual(["eq", "status", "pending"]);
  });
});
