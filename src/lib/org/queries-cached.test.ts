import { beforeEach, describe, expect, it, vi } from "vitest";

// cacheTag/cacheLife throw outside a compiled `use cache` scope under Vitest.
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

// listOrgMembersCached path:
//   from("org_members").select("user_id").eq("org_id", …).limit(…)
//   from("profiles").select(…).in("id", userIds)
const memberLimit = vi.fn();
const memberEq = vi.fn(() => ({ limit: memberLimit }));
const memberSelect = vi.fn(() => ({ eq: memberEq }));
const profilesIn = vi.fn();
const profilesSelect = vi.fn(() => ({ in: profilesIn }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) =>
      table === "org_members"
        ? { select: memberSelect }
        : { select: profilesSelect },
  }),
}));

import { listOrgMembersCached, ORG_MEMBERS_LIMIT } from "./queries-cached";

beforeEach(() => {
  memberSelect.mockClear();
  memberEq.mockClear();
  memberLimit.mockReset();
  profilesSelect.mockClear();
  profilesIn.mockReset();
});

describe("listOrgMembersCached", () => {
  it("filters by orgId (tenant boundary) and bounds the read", async () => {
    memberLimit.mockResolvedValue({ data: [{ user_id: "u1" }], error: null });
    profilesIn.mockResolvedValue({
      data: [{ id: "u1", full_name: "Ana", email: "a@x.io", avatar_url: null }],
      error: null,
    });
    const members = await listOrgMembersCached("org-A");
    expect(memberEq).toHaveBeenCalledWith("org_id", "org-A");
    expect(memberLimit).toHaveBeenCalledWith(ORG_MEMBERS_LIMIT);
    expect(members).toEqual([
      { userId: "u1", fullName: "Ana", email: "a@x.io", avatarUrl: null },
    ]);
  });

  it("keeps members whose profile row is missing (null display fields)", async () => {
    memberLimit.mockResolvedValue({ data: [{ user_id: "u2" }], error: null });
    profilesIn.mockResolvedValue({ data: [], error: null });
    expect(await listOrgMembersCached("org-A")).toEqual([
      { userId: "u2", fullName: null, email: null, avatarUrl: null },
    ]);
  });

  it("returns [] when the org has no members or on error", async () => {
    memberLimit.mockResolvedValue({ data: [], error: null });
    expect(await listOrgMembersCached("org-A")).toEqual([]);
    memberLimit.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await listOrgMembersCached("org-A")).toEqual([]);
  });
});
