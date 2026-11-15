import { describe, expect, it } from "vitest";
import { filterFolderNav, visibleFolders } from "./nav-filter";

const data = {
  folders: [
    { id: "f1", name: "DAAS", workspaceId: "w", orgId: "o", position: 0 },
    { id: "f2", name: "CRM", workspaceId: "w", orgId: "o", position: 1 },
  ],
  placements: [
    { boardId: "b1", folderId: "f1", position: 0 },
    { boardId: "b2", folderId: "f1", position: 1 },
    { boardId: "b3", folderId: "f2", position: 0 },
  ],
};

describe("filterFolderNav", () => {
  it("shows a regular member every folder but only placements of boards they can read", () => {
    const out = filterFolderNav(data, {
      isGuest: false,
      memberFolderIds: new Set(),
      readableBoardIds: new Set(["b1"]),
    });
    expect(out.folders.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(out.placements.map((p) => p.boardId)).toEqual(["b1"]);
  });
  it("shows a guest only the folders they are a member of", () => {
    const out = filterFolderNav(data, {
      isGuest: true,
      memberFolderIds: new Set(["f1"]),
      readableBoardIds: new Set(["b1", "b2", "b3"]),
    });
    expect(out.folders.map((f) => f.id)).toEqual(["f1"]);
    expect(out.placements.map((p) => p.boardId)).toEqual(["b1", "b2"]);
  });
  it("gives a guest with no folders nothing", () => {
    const out = filterFolderNav(data, {
      isGuest: true,
      memberFolderIds: new Set(),
      readableBoardIds: new Set(),
    });
    expect(out).toEqual({ folders: [], placements: [] });
  });
});

describe("visibleFolders", () => {
  const names = [
    { id: "f1", name: "DAAS" },
    { id: "f2", name: "CRM" },
  ];
  it("returns every folder for a regular member", () => {
    expect(
      visibleFolders(names, { isGuest: false, memberFolderIds: new Set() }),
    ).toEqual(names);
  });
  it("returns only a guest's folders", () => {
    expect(
      visibleFolders(names, {
        isGuest: true,
        memberFolderIds: new Set(["f2"]),
      }),
    ).toEqual([{ id: "f2", name: "CRM" }]);
  });
});
