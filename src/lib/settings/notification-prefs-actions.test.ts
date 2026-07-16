import { describe, expect, it, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const upsert = vi.fn();
const del = vi.fn();
const from = vi.fn(() => ({ upsert, delete: del }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser }, from })),
}));

import { setNotificationPreference } from "./notification-prefs-actions";

beforeEach(() => {
  getUser.mockReset();
  upsert.mockReset();
  del.mockReset();
  from.mockClear();
});

describe("setNotificationPreference", () => {
  it("disables a kind by upserting a disabled row for the caller", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    upsert.mockResolvedValue({ error: null });

    const res = await setNotificationPreference({
      kind: "mention",
      enabled: false,
    });

    expect(res.ok).toBe(true);
    expect(from).toHaveBeenCalledWith("notification_preferences");
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: "user-1",
        kind: "mention",
        channel: "in_app",
        enabled: false,
      },
      { onConflict: "user_id,kind,channel" },
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("enables a kind by deleting the disabled row", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const eqChannel = vi.fn(async () => ({ error: null }));
    const eqKind = vi.fn(() => ({ eq: eqChannel }));
    const eqUser = vi.fn(() => ({ eq: eqKind }));
    del.mockReturnValue({ eq: eqUser });

    const res = await setNotificationPreference({
      kind: "assigned",
      enabled: true,
    });

    expect(res.ok).toBe(true);
    expect(del).toHaveBeenCalled();
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-1");
    expect(eqKind).toHaveBeenCalledWith("kind", "assigned");
    expect(eqChannel).toHaveBeenCalledWith("channel", "in_app");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await setNotificationPreference({
      kind: "mention",
      enabled: false,
    });
    expect(res.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("validates the kind at the boundary", async () => {
    const res = await setNotificationPreference({
      kind: "feedback_response",
      enabled: false,
    } as never);
    expect(res.ok).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
  });
});
