import { describe, expect, it, vi } from "vitest";

/**
 * Gotcha 73 guard — a tool description is untested surface.
 *
 * Every `propose_*` verb requires ids it cannot invent. Its description names
 * the read tool that supplies each one, and that sentence ships verbatim into
 * the model's prompt. These tests refuse to take the sentence at its word:
 * for each required id they run the named read tool's REAL handler and assert
 * the id is actually present in the JSON the model receives.
 *
 * Asserting on the description string alone is what let `propose_move_item`
 * ship dead — see
 * `vault/decisions/2026-08-04-gotcha-73-a-tool-description-is-untested-surface-and-can-ship-a-dead-verb.md`.
 */

const BOARD_ID = "11111111-1111-4111-8111-111111111111";

const fixture = vi.hoisted(() => ({
  board: { id: "11111111-1111-4111-8111-111111111111", name: "Roadmap" },
  groups: [
    { id: "g-robotics", name: "Robotics" },
    { id: "g-software", name: "Software" },
  ],
  columns: [{ id: "c-due", name: "Due", kind: "date", settings: {} }],
  items: [
    { id: "i-qysea", name: "QYSEA (ROV)", group_id: "g-robotics" },
    { id: "i-sonar", name: "Sonar rig", group_id: "g-software" },
  ],
  cellValues: [],
}));

vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: vi.fn(async () => fixture),
  listMyBoards: vi.fn(async () => []),
  listSharedBoards: vi.fn(async () => []),
}));
vi.mock("@/lib/ai/embeddings/search", () => ({
  semanticSearchItems: vi.fn(async () => []),
}));

import { executeAskTool } from "@/lib/ai/ask/tools";
import { WRITE_TOOLS } from "./write-tools";

const ctx = { workspaceId: "ws-1" };

const idsAt = (payload: unknown, path: "rows" | "groups"): unknown[] => {
  if (path === "rows")
    return (payload as { id?: unknown }[]).map((row) => row.id);
  return ((payload as { groups?: { id?: unknown }[] }).groups ?? []).map(
    (g) => g.id,
  );
};

/** One row per (write verb, required id argument) pair. */
const ID_SOURCES = [
  {
    writeTool: "propose_create_item",
    arg: "group_id",
    readTool: "get_board_overview",
    readInput: { board_id: BOARD_ID },
    path: "groups" as const,
    expected: ["g-robotics", "g-software"],
  },
  {
    writeTool: "propose_move_item",
    arg: "group_id",
    readTool: "get_board_overview",
    readInput: { board_id: BOARD_ID },
    path: "groups" as const,
    expected: ["g-robotics", "g-software"],
  },
  {
    writeTool: "propose_move_item",
    arg: "item_id",
    readTool: "query_items",
    readInput: { board_id: BOARD_ID },
    path: "rows" as const,
    expected: ["i-qysea", "i-sonar"],
  },
  {
    writeTool: "propose_set_item_fields",
    arg: "item_id",
    readTool: "query_items",
    readInput: { board_id: BOARD_ID },
    path: "rows" as const,
    expected: ["i-qysea", "i-sonar"],
  },
];

describe.each(ID_SOURCES)(
  "$writeTool needs $arg, sourced from $readTool",
  ({ writeTool, arg, readTool, readInput, path, expected }) => {
    const tool = WRITE_TOOLS.find((t) => t.name === writeTool);

    it("declares the argument as required", () => {
      expect(tool).toBeDefined();
      expect(tool?.input_schema.required).toContain(arg);
    });

    it(`names ${readTool} in its description as the source`, () => {
      expect(tool?.description).toContain(readTool);
    });

    it(`${readTool}'s handler payload actually emits the id`, async () => {
      const result = await executeAskTool(readTool, readInput, ctx);
      const payload: unknown = JSON.parse(result.content);
      const ids = idsAt(payload, path);
      // The claim under test: the id survives into the JSON the model reads.
      expect(ids).toEqual(expected);
      expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(
        true,
      );
    });
  },
);

describe("query_items as a non-semantic item_id source", () => {
  it("is named by every write verb that requires an item_id", () => {
    for (const tool of WRITE_TOOLS) {
      if (!tool.input_schema.required?.includes("item_id")) continue;
      expect(tool.description).toContain("query_items");
    }
  });

  it("emits an id on every row alongside name and group", async () => {
    const result = await executeAskTool(
      "query_items",
      { board_id: BOARD_ID },
      ctx,
    );
    const rows: unknown = JSON.parse(result.content);
    expect(rows).toEqual([
      {
        id: "i-qysea",
        name: "QYSEA (ROV)",
        group: "Robotics",
        values: {},
      },
      {
        id: "i-sonar",
        name: "Sonar rig",
        group: "Software",
        values: {},
      },
    ]);
  });
});
