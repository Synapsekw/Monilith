import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, from, serviceFrom, revalidatePath } = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  serviceFrom: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, from }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: serviceFrom }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { submitFeedback, adminUpdateFeedback } from "./actions";

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
  from.mockReset();
  serviceFrom.mockReset();
  revalidatePath.mockReset();
});

describe("submitFeedback", () => {
  it("rejects an invalid payload before touching the db", async () => {
    const r = await submitFeedback({ kind: "bug", title: "", body: "x" });
    expect(r.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("inserts a row scoped to the caller's org", async () => {
    // membership lookup → org_id, then insert returning id
    const single = vi
      .fn()
      .mockResolvedValue({ data: { org_id: "o1" }, error: null });
    const insertSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "f1" }, error: null });
    from
      .mockReturnValueOnce({
        select: () => ({ eq: () => ({ limit: () => ({ single }) }) }),
      })
      .mockReturnValueOnce({
        insert: () => ({ select: () => ({ single: insertSingle }) }),
      });

    const r = await submitFeedback({
      kind: "bug",
      title: "Crash",
      body: "Boom",
    });
    expect(r.ok).toBe(true);
  });
});

describe("adminUpdateFeedback", () => {
  const FID = "00000000-0000-4000-8000-0000000000f1";

  it("updates the row and notifies the submitter via the service client", async () => {
    const updateSingle = vi.fn().mockResolvedValue({
      data: { id: FID, org_id: "o1", submitted_by: "u2" },
      error: null,
    });
    from.mockReturnValueOnce({
      update: () => ({
        eq: () => ({ select: () => ({ single: updateSingle }) }),
      }),
    });
    const notifyInsert = vi.fn().mockResolvedValue({ error: null });
    serviceFrom.mockReturnValue({ insert: notifyInsert });

    const r = await adminUpdateFeedback({ id: FID, status: "in_progress" });
    expect(r.ok).toBe(true);
    expect(serviceFrom).toHaveBeenCalledWith("notifications");
    expect(notifyInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_id: "u2",
        actor_id: "u1",
        kind: "feedback_response",
        feedback_id: FID,
        org_id: "o1",
      }),
    );
  });

  it("skips the notification when the admin is the submitter", async () => {
    const updateSingle = vi.fn().mockResolvedValue({
      data: { id: FID, org_id: "o1", submitted_by: "u1" },
      error: null,
    });
    from.mockReturnValueOnce({
      update: () => ({
        eq: () => ({ select: () => ({ single: updateSingle }) }),
      }),
    });
    const r = await adminUpdateFeedback({ id: FID, status: "resolved" });
    expect(r.ok).toBe(true);
    expect(serviceFrom).not.toHaveBeenCalled();
  });
});
