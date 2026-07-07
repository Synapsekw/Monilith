import { describe, expect, it, vi, beforeEach } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({
  updateTag: (tag: string) => updateTag(tag),
}));

const getUser = vi.fn();
const updateUser = vi.fn(async () => ({ data: {}, error: null }));
const update = vi.fn();
const maybeSingle = vi.fn(async () => ({
  data: { avatar_url: null as string | null },
}));
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

// invalidateProfileEverywhere reads the caller's org_members via the SERVICE
// client (bypasses RLS) so it also sees DEACTIVATED memberships — the org
// rosters (listOrgMembersCached) include deactivated rows, but getUserOrgs()/
// auth_user_orgs() would exclude them, leaving a stale avatar. Mock the service
// org_members read here.
const membersEq = vi.fn(async () => ({
  data: [] as { org_id: string }[],
  error: null,
}));
const serviceSelect = vi.fn(() => ({ eq: membersEq }));
const serviceFrom = vi.fn(() => ({ select: serviceSelect }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: serviceFrom }),
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
  membersEq.mockReset();
  membersEq.mockResolvedValue({ data: [], error: null });
  serviceSelect.mockClear();
  serviceFrom.mockClear();
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
    membersEq.mockResolvedValue({ data: [{ org_id: "org-1" }], error: null });
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
    // Scoped to the caller's own memberships.
    expect(serviceFrom).toHaveBeenCalledWith("org_members");
    expect(membersEq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("invalidates a deactivated-membership org that getUserOrgs would omit", async () => {
    const publicUrl =
      "https://ref.supabase.co/storage/v1/object/public/avatars/user-1/new.webp";
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    // org-2 is a DEACTIVATED membership: it appears in the org roster but NOT in
    // auth_user_orgs()/getUserOrgs(). The service-client read still returns it,
    // so its roster tag must be invalidated too (read-your-own-writes).
    membersEq.mockResolvedValue({
      data: [{ org_id: "org-1" }, { org_id: "org-2" }],
      error: null,
    });
    maybeSingle.mockResolvedValue({ data: { avatar_url: null } });
    update.mockReturnValue({ eq: async () => ({ error: null }) });
    getPublicUrl.mockReturnValue({ data: { publicUrl } });

    const res = await updateProfileAvatar({ storagePath: "user-1/new.webp" });

    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("org-members:org:org-1");
    expect(updateTag).toHaveBeenCalledWith("org-members:org:org-2");
  });

  it("removes the previous object when replacing an existing avatar", async () => {
    const publicUrl =
      "https://ref.supabase.co/storage/v1/object/public/avatars/user-1/new.webp";
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    membersEq.mockResolvedValue({ data: [{ org_id: "org-1" }], error: null });
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
    membersEq.mockResolvedValue({ data: [{ org_id: "org-1" }], error: null });
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
