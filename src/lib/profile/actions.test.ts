import { describe, expect, it, vi, beforeEach } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({
  updateTag: (tag: string) => updateTag(tag),
}));

const getUser = vi.fn();
const update = vi.fn();
const from = vi.fn(() => ({ update }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser }, from })),
}));

import { updateProfileTimezone } from "./actions";

beforeEach(() => {
  updateTag.mockReset();
  getUser.mockReset();
  update.mockReset();
  from.mockClear();
});

describe("updateProfileTimezone", () => {
  it("expires the caller's profile cache tag (read-your-own-writes) on success", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    update.mockReturnValue({ eq: async () => ({ error: null }) });

    const res = await updateProfileTimezone({ timezone: "Europe/Belgrade" });

    expect(res.ok).toBe(true);
    expect(from).toHaveBeenCalledWith("profiles");
    // Immediate cross-route invalidation, NOT a path revalidate.
    expect(updateTag).toHaveBeenCalledWith("profile:user:user-1");
  });

  it("does not invalidate when the write fails", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    update.mockReturnValue({
      eq: async () => ({ error: { message: "nope" } }),
    });

    const res = await updateProfileTimezone({ timezone: null });

    expect(res.ok).toBe(false);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller before touching the cache", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await updateProfileTimezone({ timezone: "UTC" });

    expect(res.ok).toBe(false);
    expect(updateTag).not.toHaveBeenCalled();
  });
});
