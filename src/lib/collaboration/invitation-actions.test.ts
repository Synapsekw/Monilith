import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateTag, getUser } = vi.hoisted(() => ({
  updateTag: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ updateTag }));
vi.mock("@/lib/auth/session", () => ({ getUser }));

import { refreshAccessAfterInvitation } from "./invitation-actions";

const ORG = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  updateTag.mockReset();
  getUser.mockReset().mockResolvedValue({ id: "u1" });
});

describe("refreshAccessAfterInvitation", () => {
  it("expires the session user's shared-boards, folder-membership and org-role entries", async () => {
    await refreshAccessAfterInvitation(ORG);
    expect(updateTag.mock.calls.map((c) => c[0]).sort()).toEqual(
      [
        "shared-boards:user:u1",
        "folder-members:user:u1",
        `org-admin:user:u1:org:${ORG}`,
      ].sort(),
    );
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
