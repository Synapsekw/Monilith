import { describe, expect, it } from "vitest";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";
import { groupBoardsByFolder } from "./group";

const owned = (id: string, name = id): BoardListEntry => ({
  id,
  name,
  workspace_id: "w1",
  position: 0,
  shared_out: false,
});

const shared = (id: string, name = id): SharedBoardEntry => ({
  id,
  name,
  position: 0,
  owner_name: "Ada",
  access_level: "editor",
});

describe("groupBoardsByFolder", () => {
  it("puts an owned board and a shared board in the same folder", () => {
    const result = groupBoardsByFolder({
      folders: [{ id: "f1", name: "Acme", position: 0 }],
      placements: [
        { boardId: "b1", folderId: "f1", position: 0 },
        { boardId: "s1", folderId: "f1", position: 1 },
      ],
      boards: [owned("b1")],
      sharedBoards: [shared("s1")],
    });

    expect(result.folders).toHaveLength(1);
    expect(result.folders[0].folder.name).toBe("Acme");
    expect(result.folders[0].boards.map((b) => b.board.id)).toEqual([
      "b1",
      "s1",
    ]);
    expect(result.folders[0].boards.map((b) => b.kind)).toEqual([
      "owned",
      "shared",
    ]);
    expect(result.unfiledOwned).toEqual([]);
    expect(result.unfiledShared).toEqual([]);
  });

  it("hides a folder whose boards are all invisible in this context", () => {
    // b-other lives in another workspace, so it is absent from `boards`.
    const result = groupBoardsByFolder({
      folders: [{ id: "f1", name: "Elsewhere", position: 0 }],
      placements: [{ boardId: "b-other", folderId: "f1", position: 0 }],
      boards: [owned("b1")],
      sharedBoards: [],
    });

    expect(result.folders).toEqual([]);
    expect(result.unfiledOwned.map((b) => b.id)).toEqual(["b1"]);
  });

  it("leaves unplaced boards unfiled, split by ownership", () => {
    const result = groupBoardsByFolder({
      folders: [{ id: "f1", name: "Acme", position: 0 }],
      placements: [{ boardId: "b1", folderId: "f1", position: 0 }],
      boards: [owned("b1"), owned("b2")],
      sharedBoards: [shared("s1")],
    });

    expect(result.folders[0].boards.map((b) => b.board.id)).toEqual(["b1"]);
    expect(result.unfiledOwned.map((b) => b.id)).toEqual(["b2"]);
    expect(result.unfiledShared.map((b) => b.id)).toEqual(["s1"]);
  });

  it("ignores a placement pointing at a folder that no longer exists", () => {
    const result = groupBoardsByFolder({
      folders: [],
      placements: [{ boardId: "b1", folderId: "ghost", position: 0 }],
      boards: [owned("b1")],
      sharedBoards: [],
    });

    expect(result.folders).toEqual([]);
    expect(result.unfiledOwned.map((b) => b.id)).toEqual(["b1"]);
  });

  it("orders folders by position then name, and boards by placement position", () => {
    const result = groupBoardsByFolder({
      folders: [
        { id: "f2", name: "Beta", position: 1 },
        { id: "f1", name: "Alpha", position: 1 },
        { id: "f0", name: "Zulu", position: 0 },
      ],
      placements: [
        { boardId: "b1", folderId: "f0", position: 5 },
        { boardId: "b2", folderId: "f0", position: 1 },
        { boardId: "b3", folderId: "f1", position: 0 },
        { boardId: "b4", folderId: "f2", position: 0 },
      ],
      boards: [owned("b1"), owned("b2"), owned("b3"), owned("b4")],
      sharedBoards: [],
    });

    expect(result.folders.map((f) => f.folder.id)).toEqual(["f0", "f1", "f2"]);
    expect(result.folders[0].boards.map((b) => b.board.id)).toEqual([
      "b2",
      "b1",
    ]);
  });
});
