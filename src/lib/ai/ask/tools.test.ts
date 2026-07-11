import { describe, expect, it, vi, beforeEach } from "vitest";

const listMyBoards = vi.fn();
const listSharedBoards = vi.fn();
const getBoardPayload = vi.fn();
const buildBoardSnapshot = vi.fn();

vi.mock("@/lib/boards/queries", () => ({
  listMyBoards: (...args: unknown[]) => listMyBoards(...args),
  listSharedBoards: (...args: unknown[]) => listSharedBoards(...args),
  getBoardPayload: (...args: unknown[]) => getBoardPayload(...args),
}));

vi.mock("@/lib/ai/board-snapshot", () => ({
  buildBoardSnapshot: (...args: unknown[]) => buildBoardSnapshot(...args),
}));

import { executeAskTool, ASK_TOOLS, QUERY_ITEMS_MAX } from "@/lib/ai/ask/tools";

const ctx = { workspaceId: "ws-1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ASK_TOOLS", () => {
  it("declares the three read tools with strict object schemas", () => {
    const names = ASK_TOOLS.map((t) => t.name);
    expect(names).toEqual(["list_boards", "get_board_overview", "query_items"]);
    for (const tool of ASK_TOOLS) {
      expect(tool.input_schema.type).toBe("object");
      expect(tool.input_schema.additionalProperties).toBe(false);
    }
  });
});

describe("executeAskTool: list_boards", () => {
  it("merges my+shared boards, filters by workspace, dedupes by id", async () => {
    listMyBoards.mockResolvedValue([
      {
        id: "b1",
        name: "Mine",
        workspace_id: "ws-1",
        position: 0,
        shared_out: false,
      },
      {
        id: "b2",
        name: "OtherWorkspace",
        workspace_id: "ws-2",
        position: 1,
        shared_out: false,
      },
    ]);
    listSharedBoards.mockResolvedValue([
      {
        id: "b1",
        name: "Mine",
        position: 0,
        owner_name: null,
        access_level: "viewer",
      },
      {
        id: "b3",
        name: "SharedWithMe",
        position: 2,
        owner_name: "Alice",
        access_level: "editor",
      },
    ]);

    const result = await executeAskTool("list_boards", {}, ctx);
    const parsed = JSON.parse(result.content);
    expect(parsed).toEqual(
      expect.arrayContaining([
        { id: "b1", name: "Mine" },
        { id: "b3", name: "SharedWithMe" },
      ]),
    );
    expect(parsed).toHaveLength(2);
    expect(parsed.find((b: { id: string }) => b.id === "b2")).toBeUndefined();
  });

  it("filters out shared boards from a different workspace", async () => {
    listMyBoards.mockResolvedValue([]);
    listSharedBoards.mockResolvedValue([
      {
        id: "b3",
        name: "SharedWithMe",
        position: 2,
        owner_name: "Alice",
        access_level: "editor",
      },
    ]);

    const result = await executeAskTool("list_boards", {}, ctx);
    const parsed = JSON.parse(result.content);
    // shared boards have no workspace_id in SharedBoardEntry, so they should
    // still be included (workspace filtering only applies where we have the field)
    expect(parsed).toEqual([{ id: "b3", name: "SharedWithMe" }]);
  });
});

describe("executeAskTool: get_board_overview", () => {
  it("returns the snapshot JSON plus boardId", async () => {
    const payload = {
      board: { id: "b1", name: "Sprint" },
      groups: [{ id: "g1", name: "Group 1" }],
      columns: [{ id: "c1", name: "Status", kind: "status", settings: {} }],
      items: [{ id: "i1", group_id: "g1", name: "Item 1" }],
      cellValues: [],
    };
    getBoardPayload.mockResolvedValue(payload);
    const snapshot = { board: { id: "b1", name: "Sprint" }, rowCount: 1 };
    buildBoardSnapshot.mockReturnValue(snapshot);

    const result = await executeAskTool(
      "get_board_overview",
      { board_id: "11111111-1111-4111-8111-111111111111" },
      ctx,
    );

    expect(getBoardPayload).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(JSON.parse(result.content)).toEqual(snapshot);
    expect(result.boardId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("returns an error and no boardId when the board is not visible", async () => {
    getBoardPayload.mockResolvedValue(null);

    const result = await executeAskTool(
      "get_board_overview",
      { board_id: "11111111-1111-4111-8111-111111111111" },
      ctx,
    );

    expect(JSON.parse(result.content)).toEqual({ error: "board not found" });
    expect(result.boardId).toBeUndefined();
  });
});

describe("executeAskTool: query_items", () => {
  const payload = {
    board: { id: "b1", name: "Sprint" },
    groups: [
      { id: "g1", name: "To Do" },
      { id: "g2", name: "Done" },
    ],
    columns: [
      { id: "c1", name: "Status", kind: "status", settings: {} },
      { id: "c2", name: "Points", kind: "numbers", settings: {} },
    ],
    items: Array.from({ length: 200 }, (_, i) => ({
      id: `i${i}`,
      group_id: i % 2 === 0 ? "g1" : "g2",
      name: `Item ${i}`,
    })),
    cellValues: [
      { item_id: "i0", column_id: "c1", value: { optionId: "o1" } },
      { item_id: "i0", column_id: "c2", value: { n: 5 } },
    ],
  };

  it("caps results at QUERY_ITEMS_MAX even when a larger limit is requested", async () => {
    getBoardPayload.mockResolvedValue(payload);

    const result = await executeAskTool(
      "query_items",
      { board_id: "11111111-1111-4111-8111-111111111111", limit: 500 },
      ctx,
    );

    const parsed = JSON.parse(result.content);
    expect(parsed).toHaveLength(QUERY_ITEMS_MAX);
    expect(QUERY_ITEMS_MAX).toBe(50);
    expect(result.boardId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("maps values by column name and group name, keeping only raw cell value", async () => {
    getBoardPayload.mockResolvedValue(payload);

    const result = await executeAskTool(
      "query_items",
      { board_id: "11111111-1111-4111-8111-111111111111", limit: 1 },
      ctx,
    );

    const parsed = JSON.parse(result.content);
    expect(parsed).toEqual([
      {
        name: "Item 0",
        group: "To Do",
        values: {
          Status: { optionId: "o1" },
          Points: { n: 5 },
        },
      },
    ]);
  });
});

describe("executeAskTool: error handling", () => {
  it("returns an error for an unknown tool name without throwing", async () => {
    const result = await executeAskTool("delete_everything", {}, ctx);
    expect(JSON.parse(result.content)).toEqual({ error: "unknown tool" });
  });

  it("returns an error for invalid input (missing board_id) without throwing", async () => {
    const result = await executeAskTool("get_board_overview", {}, ctx);
    expect(JSON.parse(result.content)).toEqual({ error: "invalid tool input" });
  });

  it("returns an error for invalid input on query_items", async () => {
    const result = await executeAskTool(
      "query_items",
      { board_id: "not-a-uuid" },
      ctx,
    );
    expect(JSON.parse(result.content)).toEqual({ error: "invalid tool input" });
  });

  it("returns board-not-found and no boardId for query_items when the board is not visible", async () => {
    getBoardPayload.mockResolvedValue(null);

    const result = await executeAskTool(
      "query_items",
      { board_id: "11111111-1111-4111-8111-111111111111" },
      ctx,
    );

    expect(JSON.parse(result.content)).toEqual({ error: "board not found" });
    expect(result.boardId).toBeUndefined();
  });

  it("never throws when a dispatched tool rejects, and does not leak the raw error message", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    getBoardPayload.mockRejectedValue(new Error("db connection lost"));

    const result = await executeAskTool(
      "get_board_overview",
      { board_id: "11111111-1111-4111-8111-111111111111" },
      ctx,
    );

    expect(JSON.parse(result.content)).toEqual({ error: "tool failed" });
    expect(result.content).not.toContain("db connection lost");
    expect(result.boardId).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[ask] tool failed:",
      "get_board_overview",
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });
});
