import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));
const CLIENT = { marker: "cookie-client" };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => CLIENT,
}));
const getUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getUser: () => getUser() }));
const markItemDoneCore = vi.fn();
const setItemDueDateCore = vi.fn();
vi.mock("./row-actions-core", () => ({
  markItemDoneCore: (...a: unknown[]) => markItemDoneCore(...a),
  setItemDueDateCore: (...a: unknown[]) => setItemDueDateCore(...a),
}));

import { markFocusItemDone, setFocusItemDueDate } from "./actions";

const ITEM = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  revalidatePath.mockReset();
  getUser.mockReset();
  markItemDoneCore.mockReset();
  setItemDueDateCore.mockReset();
  getUser.mockResolvedValue({ id: "u1" });
});

describe("markFocusItemDone", () => {
  it("runs the core as the signed-in member and revalidates My Work only", async () => {
    markItemDoneCore.mockResolvedValue({
      ok: true,
      data: { optionLabel: "Done" },
    });
    const res = await markFocusItemDone({ itemId: ITEM });
    expect(res).toEqual({ ok: true, data: { optionLabel: "Done" } });
    expect(markItemDoneCore).toHaveBeenCalledWith(
      CLIENT,
      { itemId: ITEM },
      "u1",
    );
    expect(revalidatePath.mock.calls).toEqual([["/my-work"]]);
  });

  it("rejects a malformed id before touching the database", async () => {
    const res = await markFocusItemDone({ itemId: "not-a-uuid" });
    expect(res.ok).toBe(false);
    expect(markItemDoneCore).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    getUser.mockResolvedValue(null);
    expect((await markFocusItemDone({ itemId: ITEM })).ok).toBe(false);
    expect(markItemDoneCore).not.toHaveBeenCalled();
  });

  it("does not revalidate when the write was refused", async () => {
    markItemDoneCore.mockResolvedValue({ ok: false, error: "denied" });
    expect(await markFocusItemDone({ itemId: ITEM })).toEqual({
      ok: false,
      error: "denied",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("setFocusItemDueDate", () => {
  it("passes the day through and revalidates My Work only", async () => {
    setItemDueDateCore.mockResolvedValue({
      ok: true,
      data: { dueDate: "2026-11-20" },
    });
    const res = await setFocusItemDueDate({
      itemId: ITEM,
      dueDate: "2026-11-20",
    });
    expect(res.ok).toBe(true);
    expect(setItemDueDateCore).toHaveBeenCalledWith(
      CLIENT,
      { itemId: ITEM, dueDate: "2026-11-20" },
      "u1",
    );
    expect(revalidatePath.mock.calls).toEqual([["/my-work"]]);
  });

  it.each(["20 Nov", "2026-11-20T10:00:00Z", ""])(
    "rejects %j as a date",
    async (dueDate) => {
      const res = await setFocusItemDueDate({ itemId: ITEM, dueDate });
      expect(res.ok).toBe(false);
      expect(setItemDueDateCore).not.toHaveBeenCalled();
    },
  );

  it("does not revalidate when the write was refused", async () => {
    setItemDueDateCore.mockResolvedValue({ ok: false, error: "denied" });
    await setFocusItemDueDate({ itemId: ITEM, dueDate: "2026-11-20" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
