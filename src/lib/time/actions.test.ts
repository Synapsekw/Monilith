import { describe, it, expect, vi, beforeEach } from "vitest";

const getAuthUser = vi.fn();
const getActiveOrgId = vi.fn();
const upsertCore = vi.fn();
const deleteResult = vi.fn();
const deleteFilters: Array<[string, unknown]> = [];

const revalidatePath = vi.fn();
const revalidateTag = vi.fn();
const updateTag = vi.fn();
const refresh = vi.fn();

/** `.from("time_allocations").delete().eq(…).eq(…).eq(…)` — awaited directly. */
function deleteChain() {
  const chain = {
    eq: (column: string, value: unknown) => {
      deleteFilters.push([column, value]);
      return chain;
    },
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(deleteResult()).then(resolve, reject),
  };
  return { delete: () => chain };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => deleteChain(),
    auth: { getUser: () => getAuthUser() },
  }),
}));
vi.mock("@/lib/org/active", () => ({
  getActiveOrgId: () => getActiveOrgId(),
}));
vi.mock("@/lib/time/allocation-core", () => ({
  upsertTimeAllocationCore: (...a: unknown[]) => upsertCore(...a),
}));
vi.mock("@/lib/time/queries", () => ({ searchAllocatableItems: vi.fn() }));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
  revalidateTag: (...a: unknown[]) => revalidateTag(...a),
  updateTag: (...a: unknown[]) => updateTag(...a),
  refresh: (...a: unknown[]) => refresh(...a),
}));

import { upsertTimeAllocation, deleteTimeAllocation } from "./actions";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

/** Nothing that makes the action response re-render the current route. */
function expectNoRevalidation() {
  expect(revalidatePath).not.toHaveBeenCalled();
  expect(revalidateTag).not.toHaveBeenCalled();
  expect(updateTag).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteFilters.length = 0;
  getActiveOrgId.mockResolvedValue(ORG_ID);
  getAuthUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  upsertCore.mockResolvedValue({ ok: true, data: { durationSecs: 7200 } });
  deleteResult.mockReturnValue({ error: null });
});

describe("upsertTimeAllocation", () => {
  it("writes the cell as the session user in the active org", async () => {
    const res = await upsertTimeAllocation({
      workDate: "2026-06-29",
      category: "Design",
      hours: 2,
    });
    expect(res).toEqual({ ok: true, data: { durationSecs: 7200 } });
    expect(upsertCore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workDate: "2026-06-29",
        category: "Design",
        durationSecs: 7200,
      }),
      { userId: USER_ID, orgId: ORG_ID },
    );
  });

  it("revalidates NOTHING on success — a cell edit must not re-render /time", async () => {
    // Any revalidatePath (even of another route, e.g. /workload) makes the
    // action's own response re-render the CURRENT route. The time card
    // reconciles locally and coalesces one trailing router.refresh() per edit
    // burst instead (TimeCard.test.tsx, "coalesced refresh").
    const res = await upsertTimeAllocation({
      workDate: "2026-06-29",
      category: "Design",
      hours: 2,
    });
    expect(res.ok).toBe(true);
    expectNoRevalidation();
  });

  it("rejects invalid input before touching auth or the database", async () => {
    const res = await upsertTimeAllocation({
      workDate: "2026-06-29",
      category: "Design",
      hours: 0,
    });
    expect(res.ok).toBe(false);
    expect(upsertCore).not.toHaveBeenCalled();
  });

  it("fails without an active org", async () => {
    getActiveOrgId.mockResolvedValue(null);
    const res = await upsertTimeAllocation({
      workDate: "2026-06-29",
      category: "Design",
      hours: 2,
    });
    expect(res).toEqual({ ok: false, error: "No organization." });
    expect(upsertCore).not.toHaveBeenCalled();
  });

  it("fails when unauthenticated, without writing", async () => {
    getAuthUser.mockResolvedValue({ data: { user: null } });
    const res = await upsertTimeAllocation({
      workDate: "2026-06-29",
      category: "Design",
      hours: 2,
    });
    expect(res).toEqual({ ok: false, error: "Not authenticated." });
    expect(upsertCore).not.toHaveBeenCalled();
  });

  it("propagates a core failure", async () => {
    upsertCore.mockResolvedValue({ ok: false, error: "denied" });
    const res = await upsertTimeAllocation({
      workDate: "2026-06-29",
      category: "Design",
      hours: 2,
    });
    expect(res).toEqual({ ok: false, error: "denied" });
    expectNoRevalidation();
  });
});

describe("deleteTimeAllocation", () => {
  it("deletes the caller's own cell, keyed by day + category", async () => {
    const res = await deleteTimeAllocation({
      workDate: "2026-06-29",
      category: "Design",
    });
    expect(res).toEqual({ ok: true, data: null });
    // user_id comes from the session, never from the input — self-only.
    expect(deleteFilters).toEqual([
      ["user_id", USER_ID],
      ["work_date", "2026-06-29"],
      ["category", "Design"],
    ]);
  });

  it("revalidates NOTHING on success", async () => {
    const res = await deleteTimeAllocation({
      workDate: "2026-06-29",
      category: "Design",
    });
    expect(res.ok).toBe(true);
    expectNoRevalidation();
  });

  it("fails when unauthenticated, without deleting", async () => {
    getAuthUser.mockResolvedValue({ data: { user: null } });
    const res = await deleteTimeAllocation({
      workDate: "2026-06-29",
      category: "Design",
    });
    expect(res).toEqual({ ok: false, error: "Not authenticated." });
    expect(deleteFilters).toEqual([]);
  });

  it("surfaces a database error", async () => {
    deleteResult.mockReturnValue({ error: { message: "rls" } });
    const res = await deleteTimeAllocation({
      workDate: "2026-06-29",
      category: "Design",
    });
    expect(res).toEqual({ ok: false, error: "rls" });
  });
});
