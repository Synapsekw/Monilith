import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Approve / reject a new account. These two actions decide who can get into a
 * multi-tenant app, so the fake service client is a tiny in-memory store that
 * RECORDS every write and APPLIES it (upsert keyed on `onConflict`), rather
 * than a bag of spies: a second user's row must provably stay untouched.
 */

type Row = Record<string, unknown>;
const { store, writes, reads, fail, getUser, getUserById, isPlatformAdmin } =
  vi.hoisted(() => ({
    store: { account_approvals: [] as Row[], admin_audit_log: [] as Row[] },
    writes: [] as { table: string; op: string; payload: unknown }[],
    reads: [] as { table: string; filters: [string, unknown][] }[],
    fail: { write: false, read: false, audit: false },
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
        if (fail.write) return { error: { message: "boom" } };
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
            if (fail.read) return { data: null, error: { message: "boom" } };
            return { data: row ? { ...row } : null, error: null };
          },
        };
        return q;
      },
      insert: async (row: Row) => {
        writes.push({ table, op: "insert", payload: row });
        if (table === "admin_audit_log" && fail.audit)
          return { error: { message: "audit boom" } };
        if (table === "account_approvals" && fail.write)
          return { error: { message: "boom" } };
        store[table].push({ ...row });
        return { error: null };
      },
      // update(...).eq(...).neq(...).select(...): the filters are RECORDED and
      // APPLIED, so dropping `.neq('status','approved')` would overwrite an
      // approved row and fail the tests below.
      update: (patch: Row) => {
        const filters: ["eq" | "neq", string, unknown][] = [];
        const q = {
          eq(column: string, value: unknown) {
            filters.push(["eq", column, value]);
            return q;
          },
          neq(column: string, value: unknown) {
            filters.push(["neq", column, value]);
            return q;
          },
          async select(columns: string) {
            writes.push({
              table,
              op: "update",
              payload: { patch, filters, columns },
            });
            if (fail.write) return { data: null, error: { message: "boom" } };
            const hit = store[table].filter((r) =>
              filters.every(([kind, c, v]) =>
                kind === "eq" ? r[c] === v : r[c] !== v,
              ),
            );
            for (const r of hit) Object.assign(r, patch);
            return {
              data: hit.map((r) => ({ user_id: r.user_id })),
              error: null,
            };
          },
        };
        return q;
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
  fail.write = false;
  fail.read = false;
  fail.audit = false;
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
    fail.write = true;
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
    // The guarded update is attempted but matches nothing; no insert/upsert.
    expect(writes.filter((w) => w.op !== "update")).toEqual([]);
    expect(store.admin_audit_log).toEqual([]);
    expect(rowOf(target)?.status).toBe("approved");
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a pending account with one guarded update and no read", async () => {
    await platformRejectUser({ userId: target });
    expect(reads).toEqual([]);
    const updates = writes.filter((w) => w.op === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.payload).toMatchObject({
      filters: [
        ["eq", "user_id", target],
        ["neq", "status", "approved"],
      ],
    });
  });

  it("reads only the target's own row after an update that matched nothing", async () => {
    store.account_approvals = [
      {
        user_id: target,
        status: "approved",
        decided_at: "t",
        decided_by: actor,
      },
    ];
    await platformRejectUser({ userId: target });
    expect(reads).toEqual([
      { table: "account_approvals", filters: [["user_id", target]] },
    ]);
  });

  it("never overwrites an approved row (the guard is in the update)", async () => {
    store.account_approvals = [
      {
        user_id: target,
        status: "approved",
        decided_at: "t",
        decided_by: actor,
      },
    ];
    await platformRejectUser({ userId: target });
    expect(rowOf(target)).toMatchObject({
      status: "approved",
      decided_at: "t",
    });
  });

  it("fails on a failed update with no audit row and no tag cleared", async () => {
    fail.write = true;
    const r = await platformRejectUser({ userId: target });
    expect(r).toEqual({ ok: false, error: "Could not reject that account." });
    expect(store.admin_audit_log).toEqual([]);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("fails on a failed follow-up read with no audit row and no tag cleared", async () => {
    store.account_approvals = [];
    fail.read = true;
    const r = await platformRejectUser({ userId: target });
    expect(r).toEqual({ ok: false, error: "Could not reject that account." });
    expect(writes.filter((w) => w.op === "insert")).toEqual([]);
    expect(store.admin_audit_log).toEqual([]);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("inserts a rejected row when the account has none", async () => {
    store.account_approvals = [];
    await platformRejectUser({ userId: target });
    expect(writes).toContainEqual(
      expect.objectContaining({ table: "account_approvals", op: "insert" }),
    );
    expect(rowOf(target)).toMatchObject({
      status: "rejected",
      decided_by: actor,
    });
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

describe.each([
  ["approve", platformApproveUser],
  ["reject", platformRejectUser],
] as const)("%s — audit trail", (_name, action) => {
  it("logs a failed audit insert, still returns ok and clears the tag", async () => {
    fail.audit = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await action({ userId: target });
    expect(r.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith(`account-approval:${target}`);
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("records a null target_email when the user lookup fails", async () => {
    getUserById.mockResolvedValue({
      data: { user: null },
      error: { message: "gone" },
    });
    const r = await action({ userId: target });
    expect(r.ok).toBe(true);
    expect(store.admin_audit_log[0]).toMatchObject({ target_email: null });
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
