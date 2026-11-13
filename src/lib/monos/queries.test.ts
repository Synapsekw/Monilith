import { describe, expect, it, vi } from "vitest";
import { getMyMono, listMonoBoards, MONO_BOARDS_LIMIT } from "./queries";

describe("getMyMono", () => {
  it("maps the RPC row and narrows brain", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          user_id: "m1",
          org_id: "o1",
          owner_id: "u1",
          name: "Nova",
          color: "#7395ff",
          brain: "key",
          key_provider: "openai",
          last_seen_at: null,
          created_at: "2026-11-13T00:00:00Z",
        },
      ],
      error: null,
    }));
    const mono = await getMyMono({ rpc } as never, "o1");
    expect(rpc).toHaveBeenCalledWith("get_my_mono", { p_org_id: "o1" });
    expect(mono).toEqual({
      userId: "m1",
      orgId: "o1",
      ownerId: "u1",
      name: "Nova",
      color: "#7395ff",
      brain: "key",
      keyProvider: "openai",
      lastSeenAt: null,
      createdAt: "2026-11-13T00:00:00Z",
    });
  });

  it("returns null when the caller has no Mono", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    expect(await getMyMono({ rpc } as never, "o1")).toBeNull();
  });
});

describe("listMonoBoards", () => {
  it("is a bounded read of the Mono's own board rows", async () => {
    const limit = vi.fn(async () => ({
      data: [
        { board_id: "b1", access_level: "editor", boards: { name: "Launch" } },
        { board_id: "b2", access_level: "viewer", boards: null },
      ],
      error: null,
    }));
    const eq = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const boards = await listMonoBoards({ from } as never, "m1");
    expect(from).toHaveBeenCalledWith("board_members");
    expect(eq).toHaveBeenCalledWith("user_id", "m1");
    expect(limit).toHaveBeenCalledWith(MONO_BOARDS_LIMIT);
    expect(boards).toEqual([
      { boardId: "b1", name: "Launch", accessLevel: "editor" },
      { boardId: "b2", name: "Untitled board", accessLevel: "viewer" },
    ]);
  });
});
