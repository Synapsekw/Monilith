import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateTag, getUser } = vi.hoisted(() => ({
  updateTag: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ updateTag }));
vi.mock("@/lib/auth/session", () => ({ getUser }));
const membership: { row: unknown } = { row: { org_id: "x" } };
vi.mock("@/lib/supabase/server", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: async () => ({ data: membership.row, error: null }),
  };
  return { createClient: async () => ({ from: () => chain }) };
});

import { refreshAccessAfterInvitation } from "./invitation-actions";

const ORG = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  updateTag.mockReset();
  getUser.mockReset().mockResolvedValue({ id: "u1" });
  membership.row = { org_id: ORG };
});

describe("refreshAccessAfterInvitation", () => {
  it("expires the session user's entries and the joined org's member list", async () => {
    await refreshAccessAfterInvitation(ORG);
    expect(updateTag.mock.calls.map((c) => c[0]).sort()).toEqual(
      [
        "shared-boards:user:u1",
        "folder-members:user:u1",
        `org-admin:user:u1:org:${ORG}`,
        `org-members:org:${ORG}`,
      ].sort(),
    );
  });

  it("leaves an org's member list alone when the user is not a member of it", async () => {
    membership.row = null;
    await refreshAccessAfterInvitation(ORG);
    expect(updateTag).not.toHaveBeenCalledWith(`org-members:org:${ORG}`);
  });

  it("still expires the two user tags when no valid org id is passed", async () => {
    await refreshAccessAfterInvitation("not-a-uuid");
    expect(updateTag.mock.calls.map((c) => c[0]).sort()).toEqual([
      "folder-members:user:u1",
      "shared-boards:user:u1",
    ]);
  });

  it("does nothing without a session", async () => {
    getUser.mockResolvedValue(null);
    await refreshAccessAfterInvitation(ORG);
    expect(updateTag).not.toHaveBeenCalled();
  });
});
