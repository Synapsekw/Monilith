import { describe, expect, it, vi } from "vitest";
import { higherAccess, listMyFolderBoardLevels } from "./folder-levels";

describe("higherAccess", () => {
  it("returns null when there is neither a direct nor a folder grant", () => {
    expect(higherAccess(null, null)).toBeNull();
  });
  it("returns the only grant present", () => {
    expect(higherAccess("viewer", null)).toBe("viewer");
    expect(higherAccess(null, "editor")).toBe("editor");
  });
  it("returns editor when either side is editor", () => {
    expect(higherAccess("viewer", "editor")).toBe("editor");
    expect(higherAccess("editor", "viewer")).toBe("editor");
  });
});

describe("listMyFolderBoardLevels", () => {
  it("does not call the database for an empty id list", async () => {
    const rpc = vi.fn();
    const levels = await listMyFolderBoardLevels({ rpc } as never, []);
    expect(levels.size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps rows by board id", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ board_id: "b1", access_level: "editor" }],
      error: null,
    }));
    const levels = await listMyFolderBoardLevels({ rpc } as never, [
      "b1",
      "b2",
    ]);
    expect(rpc).toHaveBeenCalledWith("my_folder_board_levels", {
      p_board_ids: ["b1", "b2"],
    });
    expect(levels.get("b1")).toBe("editor");
    expect(levels.has("b2")).toBe(false);
  });
  it("fails closed to no folder access when the read errors or throws", async () => {
    const erroring = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "x" } })),
    };
    expect(
      (await listMyFolderBoardLevels(erroring as never, ["b1"])).size,
    ).toBe(0);
    const throwing = {} as never;
    expect((await listMyFolderBoardLevels(throwing, ["b1"])).size).toBe(0);
  });
});
