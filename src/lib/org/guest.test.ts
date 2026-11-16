import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActiveOrgId, getFolderAccessForUserCached } = vi.hoisted(() => ({
  getActiveOrgId: vi.fn(),
  getFolderAccessForUserCached: vi.fn(),
}));
vi.mock("@/lib/org/active", () => ({
  getActiveOrgId: () => getActiveOrgId(),
}));
vi.mock("@/lib/folders/access-cached", () => ({
  getFolderAccessForUserCached: (u: string, o: string) =>
    getFolderAccessForUserCached(u, o),
}));

import { isActiveOrgGuest } from "./guest";

beforeEach(() => {
  getActiveOrgId.mockReset().mockResolvedValue("o1");
  getFolderAccessForUserCached
    .mockReset()
    .mockResolvedValue({ isGuest: false, folderIds: [] });
});

describe("isActiveOrgGuest", () => {
  it("asks the shell's cached role read for this user and the active org", async () => {
    getFolderAccessForUserCached.mockResolvedValue({
      isGuest: true,
      folderIds: ["f1"],
    });
    expect(await isActiveOrgGuest("u1")).toBe(true);
    expect(getFolderAccessForUserCached).toHaveBeenCalledWith("u1", "o1");
  });

  it("is false for a full member", async () => {
    expect(await isActiveOrgGuest("u1")).toBe(false);
  });

  it("is false, with no read, when there is no active org", async () => {
    getActiveOrgId.mockResolvedValue("");
    expect(await isActiveOrgGuest("u1")).toBe(false);
    expect(getFolderAccessForUserCached).not.toHaveBeenCalled();
  });
});
