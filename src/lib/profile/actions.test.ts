import { describe, expect, it, vi, beforeEach } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({
  updateTag: (tag: string) => updateTag(tag),
}));

const getUser = vi.fn();
const updateUser = vi.fn(async () => ({ data: {}, error: null }));
const update = vi.fn();
const maybeSingle = vi.fn(async () => ({ data: { avatar_url: null } }));
const select = vi.fn(() => ({ eq: () => ({ maybeSingle }) }));
const from = vi.fn(() => ({ update, select }));
const getPublicUrl = vi.fn();
const storageRemove = vi.fn(async () => ({ data: [], error: null }));
const storageFrom = vi.fn(() => ({ getPublicUrl, remove: storageRemove }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser, updateUser },
    from,
    storage: { from: storageFrom },
  })),
}));

const getUserOrgs = vi.fn(async () => [] as { id: string }[]);
vi.mock("@/lib/auth/session", () => ({
  getUserOrgs: () => getUserOrgs(),
}));

import {
  removeProfileAvatar,
  updateProfileAvatar,
  updateProfileTimezone,
} from "./actions";

beforeEach(() => {
  updateTag.mockReset();
  getUser.mockReset();
  updateUser.mockReset();
  updateUser.mockResolvedValue({ data: {}, error: null });
  update.mockReset();
  maybeSingle.mockReset();
  maybeSingle.mockResolvedValue({ data: { avatar_url: null } });
  select.mockClear();
  from.mockClear();
  getPublicUrl.mockReset();
  storageRemove.mockReset();
  storageRemove.mockResolvedValue({ data: [], error: null });
  storageFrom.mockClear();
  getUserOrgs.mockReset();
  getUserOrgs.mockResolvedValue([]);
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

describe("updateProfileAvatar", () => {
  it("rejects a storagePath outside the caller's own prefix", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const res = await updateProfileAvatar({
      storagePath: "someone-else/x.webp",
    });

    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("writes avatar_url, mirrors metadata, invalidates profile + roster tags", async () => {
    const publicUrl =
      "https://ref.supabase.co/storage/v1/object/public/avatars/user-1/new.webp";
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    getUserOrgs.mockResolvedValue([{ id: "org-1" }]);
    maybeSingle.mockResolvedValue({ data: { avatar_url: null } });
    update.mockReturnValue({ eq: async () => ({ error: null }) });
    getPublicUrl.mockReturnValue({ data: { publicUrl } });

    const res = await updateProfileAvatar({ storagePath: "user-1/new.webp" });

    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ avatar_url: publicUrl });
    expect(updateUser).toHaveBeenCalledWith({
      data: { avatar_url: expect.stringContaining("/avatars/user-1/new.webp") },
    });
    expect(updateTag).toHaveBeenCalledWith("profile:user:user-1");
    expect(updateTag).toHaveBeenCalledWith("org-members:org:org-1");
  });

  it("removes the previous object when replacing an existing avatar", async () => {
    const publicUrl =
      "https://ref.supabase.co/storage/v1/object/public/avatars/user-1/new.webp";
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    getUserOrgs.mockResolvedValue([{ id: "org-1" }]);
    maybeSingle.mockResolvedValue({
      data: {
        avatar_url:
          "https://ref.supabase.co/storage/v1/object/public/avatars/user-1/old.webp",
      },
    });
    update.mockReturnValue({ eq: async () => ({ error: null }) });
    getPublicUrl.mockReturnValue({ data: { publicUrl } });

    const res = await updateProfileAvatar({ storagePath: "user-1/new.webp" });

    expect(res.ok).toBe(true);
    expect(storageRemove).toHaveBeenCalledWith(["user-1/old.webp"]);
  });
});

describe("removeProfileAvatar", () => {
  it("nulls the column and deletes the stored object", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    getUserOrgs.mockResolvedValue([{ id: "org-1" }]);
    maybeSingle.mockResolvedValue({
      data: {
        avatar_url:
          "https://ref.supabase.co/storage/v1/object/public/avatars/user-1/old.webp",
      },
    });
    update.mockReturnValue({ eq: async () => ({ error: null }) });

    const res = await removeProfileAvatar();

    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ avatar_url: null });
    expect(storageRemove).toHaveBeenCalledWith(["user-1/old.webp"]);
    expect(updateTag).toHaveBeenCalledWith("org-members:org:org-1");
  });

  it("rejects an unauthenticated caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await removeProfileAvatar();

    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
