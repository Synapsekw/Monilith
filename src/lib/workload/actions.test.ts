import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
const getUser = vi.fn();
const getActiveOrgId = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, auth: { getUser } }),
}));
vi.mock("@/lib/org/active", () => ({
  getActiveOrgId: () => getActiveOrgId(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  upsertMemberCapacity,
  setWorkloadDefaults,
} from "@/lib/workload/actions";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

/** `.upsert(values, options)` awaited directly for `{ error }`. */
function upsertChain(
  table: string,
  error: unknown,
  onUpsert?: (values: unknown, options: unknown) => void,
) {
  return (t: string) => {
    if (t !== table) return {} as never;
    return {
      upsert: async (values: unknown, options: unknown) => {
        onUpsert?.(values, options);
        return { error };
      },
    } as never;
  };
}

beforeEach(() => {
  from.mockReset();
  getUser.mockReset();
  getActiveOrgId.mockReset();
  getActiveOrgId.mockResolvedValue(ORG_ID);
  getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
});

describe("upsertMemberCapacity", () => {
  const valid = { userId: USER_ID, hoursPerDay: 6, workingDays: [1, 2, 3] };

  it("rejects an invalid user id before resolving the org or touching the DB", async () => {
    const res = await upsertMemberCapacity({ ...valid, userId: "nope" });
    expect(res.ok).toBe(false);
    expect(getActiveOrgId).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects out-of-range hours before touching the DB", async () => {
    const res = await upsertMemberCapacity({ ...valid, hoursPerDay: 25 });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("persists the capacity row keyed on (org_id, user_id)", async () => {
    const onUpsert = vi.fn();
    from.mockImplementation(upsertChain("member_capacity", null, onUpsert));
    const res = await upsertMemberCapacity(valid);
    expect(from).toHaveBeenCalledWith("member_capacity");
    expect(onUpsert).toHaveBeenCalledWith(
      {
        org_id: ORG_ID,
        user_id: USER_ID,
        hours_per_day: 6,
        working_days: [1, 2, 3],
        created_by: USER_ID,
      },
      { onConflict: "org_id,user_id" },
    );
    expect(res).toEqual({ ok: true, data: null });
  });

  it("fails when there is no active org", async () => {
    getActiveOrgId.mockResolvedValue("");
    const res = await upsertMemberCapacity(valid);
    expect(res).toEqual({ ok: false, error: "No organization." });
    expect(from).not.toHaveBeenCalled();
  });

  it("fails when there is no authenticated user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await upsertMemberCapacity(valid);
    expect(res).toEqual({ ok: false, error: "Not authenticated." });
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces an upsert error as a typed failure", async () => {
    from.mockImplementation(
      upsertChain("member_capacity", { message: "rls denied" }),
    );
    const res = await upsertMemberCapacity(valid);
    expect(res).toEqual({ ok: false, error: "rls denied" });
  });
});

describe("setWorkloadDefaults", () => {
  const valid = {
    defaultHoursPerDay: 8,
    defaultPerItemHours: 4,
    defaultWorkingDays: [1, 2, 3, 4, 5],
  };

  it("rejects an out-of-range default before resolving the org or touching the DB", async () => {
    const res = await setWorkloadDefaults({
      ...valid,
      defaultHoursPerDay: 99,
    });
    expect(res.ok).toBe(false);
    expect(getActiveOrgId).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects an invalid weekday before touching the DB", async () => {
    const res = await setWorkloadDefaults({
      ...valid,
      defaultWorkingDays: [0],
    });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("persists the org defaults keyed on org_id", async () => {
    const onUpsert = vi.fn();
    from.mockImplementation(
      upsertChain("org_workload_settings", null, onUpsert),
    );
    const res = await setWorkloadDefaults(valid);
    expect(from).toHaveBeenCalledWith("org_workload_settings");
    expect(onUpsert).toHaveBeenCalledWith(
      {
        org_id: ORG_ID,
        default_hours_per_day: 8,
        default_per_item_hours: 4,
        default_working_days: [1, 2, 3, 4, 5],
      },
      { onConflict: "org_id" },
    );
    expect(res).toEqual({ ok: true, data: null });
  });

  it("fails when there is no active org", async () => {
    getActiveOrgId.mockResolvedValue("");
    const res = await setWorkloadDefaults(valid);
    expect(res).toEqual({ ok: false, error: "No organization." });
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces an upsert error as a typed failure", async () => {
    from.mockImplementation(
      upsertChain("org_workload_settings", { message: "not an admin" }),
    );
    const res = await setWorkloadDefaults(valid);
    expect(res).toEqual({ ok: false, error: "not an admin" });
  });
});
