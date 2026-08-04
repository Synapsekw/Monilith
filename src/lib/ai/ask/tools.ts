import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  getBoardPayload,
  listMyBoards,
  listSharedBoards,
} from "@/lib/boards/queries";
import { buildBoardSnapshot } from "@/lib/ai/board-snapshot";
import { semanticSearchItems } from "@/lib/ai/embeddings/search";

/** Hard cap on rows `query_items` may return, regardless of requested limit —
 *  keeps tool output (and downstream model context) bounded. */
export const QUERY_ITEMS_MAX = 50;

const getBoardOverviewSchema = z.object({
  board_id: z.string().uuid(),
});

const queryItemsSchema = z.object({
  board_id: z.string().uuid(),
  limit: z.number().int().positive().optional(),
});

const semanticSearchSchema = z.object({
  query: z.string().trim().min(2).max(100),
});

/** Read-only tool declarations for the Ask Pulse Anthropic tool-use loop.
 *  Every tool resolves through RLS-scoped queries (`@/lib/boards/queries`,
 *  cookie-bound client) — cross-org access is impossible by construction.
 *  Never wire the service client into this module. */
export const ASK_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_boards",
    description:
      "List the boards visible to the current user in the current workspace (owned or shared with them). Returns id and name for each board.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_board_overview",
    description:
      "Get a board's schema and aggregate statistics (row count, group ids and names, column definitions, fill rates, distributions, numeric/date ranges) — no raw item rows. Use this to understand a board's shape before querying items, and to resolve a group's name to its id.",
    input_schema: {
      type: "object",
      properties: {
        board_id: { type: "string", description: "UUID of the board." },
      },
      required: ["board_id"],
      additionalProperties: false,
    },
  },
  {
    name: "query_items",
    description: `List up to ${QUERY_ITEMS_MAX} items on a board with their group and column values.`,
    input_schema: {
      type: "object",
      properties: {
        board_id: { type: "string", description: "UUID of the board." },
        limit: {
          type: "number",
          description: `Max items to return (default/cap ${QUERY_ITEMS_MAX}).`,
        },
      },
      required: ["board_id"],
      additionalProperties: false,
    },
  },
  {
    name: "semantic_search_items",
    description:
      "Find items by MEANING, not keywords: given a natural-language query, returns up to 20 items ranked by semantic (conceptual) similarity across every board the user can read. Prefer this over query_items when the user asks about a topic, theme, or intent (e.g. 'anything about onboarding') rather than an exact item name or a specific board. Returns id, name, boardId, boardName per hit.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language query (2–100 characters).",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

const errorResult = (message: string) => ({
  content: JSON.stringify({ error: message }),
});

async function runListBoards(ctx: {
  workspaceId: string;
}): Promise<{ content: string }> {
  const [mine, shared] = await Promise.all([
    listMyBoards(),
    listSharedBoards(),
  ]);
  const byId = new Map<string, { id: string; name: string }>();
  for (const b of mine)
    if (b.workspace_id === ctx.workspaceId)
      byId.set(b.id, { id: b.id, name: b.name });
  // SharedBoardEntry carries no workspace_id (targets can live in another
  // workspace only via cross-workspace sharing, which the RLS-scoped read
  // already gates) — include as-is, keyed by id so a board shared into and
  // also owned within the workspace dedupes to a single entry.
  for (const b of shared)
    if (!byId.has(b.id)) byId.set(b.id, { id: b.id, name: b.name });
  return { content: JSON.stringify([...byId.values()]) };
}

async function runGetBoardOverview(
  input: unknown,
): Promise<{ content: string; boardId?: string }> {
  const parsed = getBoardOverviewSchema.safeParse(input);
  if (!parsed.success) return errorResult("invalid tool input");
  const payload = await getBoardPayload(parsed.data.board_id);
  if (!payload) return errorResult("board not found");
  const snapshot = buildBoardSnapshot({
    board: payload.board,
    groups: payload.groups,
    columns: payload.columns,
    items: payload.items,
    cellValues: payload.cellValues,
  });
  return { content: JSON.stringify(snapshot), boardId: parsed.data.board_id };
}

async function runQueryItems(
  input: unknown,
): Promise<{ content: string; boardId?: string }> {
  const parsed = queryItemsSchema.safeParse(input);
  if (!parsed.success) return errorResult("invalid tool input");
  const payload = await getBoardPayload(parsed.data.board_id);
  if (!payload) return errorResult("board not found");

  const groupNameById = new Map(payload.groups.map((g) => [g.id, g.name]));
  const columnNameById = new Map(payload.columns.map((c) => [c.id, c.name]));
  const cellsByItem = new Map<
    string,
    { column_id: string; value: unknown }[]
  >();
  for (const cell of payload.cellValues) {
    const arr = cellsByItem.get(cell.item_id) ?? [];
    arr.push({ column_id: cell.column_id, value: cell.value });
    cellsByItem.set(cell.item_id, arr);
  }

  const limit = Math.min(parsed.data.limit ?? QUERY_ITEMS_MAX, QUERY_ITEMS_MAX);
  const rows = payload.items.slice(0, limit).map((item) => {
    const values: Record<string, unknown> = {};
    for (const cell of cellsByItem.get(item.id) ?? []) {
      const columnName = columnNameById.get(cell.column_id);
      if (columnName) values[columnName] = cell.value;
    }
    return {
      name: item.name,
      group: groupNameById.get(item.group_id) ?? null,
      values,
    };
  });

  return { content: JSON.stringify(rows), boardId: parsed.data.board_id };
}

/** Meaning-based item retrieval. Delegates to `semanticSearchItems`, which
 *  resolves the caller server-side, meters one embed call (feature
 *  `semantic_query`), and ranks via the RLS-scoped `match_items` RPC — so, like
 *  every other Ask tool, cross-org access is impossible and it never throws. */
async function runSemanticSearch(input: unknown): Promise<{ content: string }> {
  const parsed = semanticSearchSchema.safeParse(input);
  if (!parsed.success) return errorResult("invalid tool input");
  const results = await semanticSearchItems(parsed.data.query);
  return { content: JSON.stringify(results) };
}

/** Dispatch + execute an Ask Pulse tool call. Never throws — invalid input, an
 *  unknown tool name, or an underlying error (e.g. a DB failure inside
 *  `getBoardPayload`/`listMyBoards`/`listSharedBoards`) all resolve to an
 *  `{"error": ...}` content payload so the model gets a chance to self-correct
 *  within the tool-use loop. */
export async function executeAskTool(
  name: string,
  input: unknown,
  ctx: { workspaceId: string },
): Promise<{ content: string; boardId?: string }> {
  try {
    switch (name) {
      case "list_boards":
        return await runListBoards(ctx);
      case "get_board_overview":
        return await runGetBoardOverview(input);
      case "query_items":
        return await runQueryItems(input);
      case "semantic_search_items":
        return await runSemanticSearch(input);
      default:
        return errorResult("unknown tool");
    }
  } catch (err) {
    console.error("[ask] tool failed:", name, err);
    return errorResult("tool failed");
  }
}
