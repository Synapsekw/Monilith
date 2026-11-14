import { describe, expect, it } from "vitest";
import { mergeSharedBoards } from "./shared-merge";

const entry = (id: string, level: "viewer" | "editor", position = 0) => ({
  id,
  name: `Board ${id}`,
  position,
  owner_name: "Owner",
  access_level: level,
});

describe("mergeSharedBoards", () => {
  it("keeps direct grants and adds boards reached only through a folder", () => {
    const out = mergeSharedBoards(
      [entry("a", "viewer")],
      [entry("b", "editor")],
    );
    expect(out.map((b) => b.id)).toEqual(["a", "b"]);
  });
  it("lists a board once, at the higher level", () => {
    const out = mergeSharedBoards(
      [entry("a", "viewer")],
      [entry("a", "editor")],
    );
    expect(out).toHaveLength(1);
    expect(out[0].access_level).toBe("editor");
  });
  it("does not lower a direct editor grant to a folder viewer grant", () => {
    const out = mergeSharedBoards(
      [entry("a", "editor")],
      [entry("a", "viewer")],
    );
    expect(out[0].access_level).toBe("editor");
  });
  it("merges duplicates inside the folder list at the higher level", () => {
    const out = mergeSharedBoards(
      [],
      [entry("a", "viewer"), entry("a", "editor")],
    );
    expect(out).toHaveLength(1);
    expect(out[0].access_level).toBe("editor");
  });
});
