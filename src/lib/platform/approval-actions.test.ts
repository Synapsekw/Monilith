import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Approve / reject a new account. These two actions decide who can get into a
 * multi-tenant app, so the fake service client is a tiny in-memory store that
 * RECORDS every write and APPLIES it (upsert keyed on `onConflict`), rather
 * than a bag of spies: a second user's row must provably stay untouched.
 */

type Row = Record<string, unknown>;
const {
  store,
  writes,
  reads,
  failUpsert,
  getUser,
  getUserById,
  isPlatformAdmin,
} = vi.hoisted(() => ({
  store: { account_approvals: [] as Row[], admin_audit_log: [] as Row[] },
  writes: [] as { table: string; op: string; payload: unknown }[],
  reads: [] as { table: string; filters: [string, unknown][] }[],
  failUpsert: { on: false },
  getUser: vi.fn(),
  getUserById: vi.fn(),
  isPlatformAdmin: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: { admin: { getUserById } },
    from: (table: keyof typeof store) => ({
      upsert: async (row: Row, opts?: { onConflict?: string }) => {
        writes.push({ table, op: "upsert", payload: row });
        if (failUpsert.on) return { error: { message: "boom" } };
        const key = opts?.onConflict ?? "id";
        const rows = store[table];
        const i = rows.findIndex((r) => r[key] === row[key]);
        if (i >= 0) rows[i] = { ...rows[i], ...row };
        else rows.push({ ...row });
        return { error: null };
      },
      select: () => {
        const read = {
          table: String(table),
          filters: [] as [string, unknown][],
        };
        reads.push(read);
        const q = {
          eq(column: string, value: unknown) {
            read.filters.push([column, value]);
            return q;
          },
          async maybeSingle() {
            const row = store[table].find((r) =>
              read.filters.every(([c, v]) => r[c] === v),
            );
            return { data: row ? { ...row } : null, error: null };
          },
        };
        return q;
      },
      insert: async (row: Row) => {
        writes.push({ table, op: "insert", payload: row });
        store[table].push({ ...row });
        return { error: null };
      },
    }),
  }),
}));

vi.mock("./guard", () => ({ isPlatformAdmin: () => isPlatformAdmin() }));
const { updateTag, revalidatePath } = vi.hoisted(() => ({
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ updateTag, revalidatePath }));

import { platformApproveUser, platformRejectUser } from "./actions";

const actor = "00000000-0000-4000-8000-000000000000";
const target = "11111111-1111-4111-8111-111111111111";
const other = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  store.account_approvals = [
    { user_id: target, status: "pending", decided_at: null, decided_by: null },
    { user_id: other, status: "pending", decided_at: null, decided_by: null },
  ];
  store.admin_audit_log = [];
  writes.length = 0;
  reads.length = 0;
  failUpsert.on = false;
  getUser.mockReset().mockResolvedValue({ data: { user: { id: actor } } });
  getUserById.mockReset().mockResolvedValue({
    data: { user: { id: target, email: "new@example.com" } },
    error: null,
  });
  isPlatformAdmin.mockReset().mockResolvedValue(true);
  updateTag.mockReset();
  revalidatePath.mockReset();
});

const rowOf = (id: string) =>
  store.account_approvals.find((r) => r.user_id === id);

describe.each([
  ["approve", platformApproveUser, "approved", "platform.user_approved"],
  ["reject", platformRejectUser, "rejected", "platform.user_rejected"],
] as const)("%s", (_name, action, status, auditAction) => {
  it("fails on invalid input and writes nothing", async () => {
    const r = await action({ userId: "not-a-uuid" });
    expect(r.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("fails when unauthenticated and writes nothing", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const r = await action({ userId: target });
    expect(r.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("fails for a non-admin and writes nothing", async () => {
    isPlatformAdmin.mockResolvedValue(false);
    const r = await action({ userId: target });
    expect(r).toEqual({ ok: false, error: "Not authorized." });
    expect(writes).toEqual([]);
    expect(reads).toEqual([]);
    expect(getUserById).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it(`sets exactly that account to ${status}, leaving others unchanged`, async () => {
    const r = await action({ userId: target });
    expect(r.ok).toBe(true);
    expect(rowOf(target)).toMatchObject({ status, decided_by: actor });
    expect(typeof rowOf(target)?.decided_at).toBe("string");
    expect(rowOf(other)).toEqual({
      user_id: other,
      status: "pending",
      decided_at: null,
      decided_by: null,
    });
  });

  it("inserts the row when the account has none (upsert on user_id)", async () => {
    store.account_approvals = [];
    const r = await action({ userId: target });
    expect(r.ok).toBe(true);
    expect(store.account_approvals).toHaveLength(1);
    expect(rowOf(target)).toMatchObject({ status, decided_by: actor });
  });

  it("writes a platform audit row with the target email", async () => {
    await action({ userId: target });
    expect(store.admin_audit_log).toEqual([
      {
        org_id: null,
        actor_id: actor,
        actor_kind: "platform",
        action: auditAction,
        target_user_id: target,
        target_email: "new@example.com",
        metadata: {},
      },
    ]);
  });

  it("clears the account's approval tag and revalidates /admin", async () => {
    await action({ userId: target });
    expect(updateTag).toHaveBeenCalledWith(`account-approval:${target}`);
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("fails on a database error with no audit row and no tag cleared", async () => {
    failUpsert.on = true;
    const r = await action({ userId: target });
    expect(r.ok).toBe(false);
    expect(store.admin_audit_log).toEqual([]);
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("rejecting an account that is already approved", () => {
  const message =
    "This account is already approved. Use Deactivate to remove its access.";

  it("fails with a pointer to Deactivate and changes nothing", async () => {
    store.account_approvals = [
      {
        user_id: target,
        status: "approved",
        decided_at: "t",
        decided_by: actor,
      },
    ];
    const r = await platformRejectUser({ userId: target });
    expect(r).toEqual({ ok: false, error: message });
    expect(writes).toEqual([]);
    expect(store.admin_audit_log).toEqual([]);
    expect(rowOf(target)?.status).toBe("approved");
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reads only the target's own row", async () => {
    await platformRejectUser({ userId: target });
    expect(reads).toEqual([
      { table: "account_approvals", filters: [["user_id", target]] },
    ]);
  });

  it("does not read before approving", async () => {
    await platformApproveUser({ userId: target });
    expect(reads).toEqual([]);
  });

  it("still lets an already rejected account be rejected again", async () => {
    store.account_approvals = [
      {
        user_id: target,
        status: "rejected",
        decided_at: "t",
        decided_by: actor,
      },
    ];
    expect((await platformRejectUser({ userId: target })).ok).toBe(true);
  });

  it("still lets an account with no row be rejected", async () => {
    store.account_approvals = [];
    expect((await platformRejectUser({ userId: target })).ok).toBe(true);
  });

  it("can approve an account that is already approved (no guard)", async () => {
    store.account_approvals = [
      {
        user_id: target,
        status: "approved",
        decided_at: "t",
        decided_by: actor,
      },
    ];
    expect((await platformApproveUser({ userId: target })).ok).toBe(true);
  });
});

describe("self-decisions", () => {
  it("refuses to let an admin reject their own account", async () => {
    const r = await platformRejectUser({ userId: actor });
    expect(r.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("allows an admin to approve their own account", async () => {
    const r = await platformApproveUser({ userId: actor });
    expect(r.ok).toBe(true);
  });
});
