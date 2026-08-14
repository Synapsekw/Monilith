import { z } from "zod";
import type { GetClient, ToolResult } from "./shared";
import type { ToolDescriptor } from "./descriptor";

export const SEARCH_LIMIT = 50;

const searchItemsInput = {
  boardId: z.string().uuid(),
  query: z.string().trim().min(1).max(100),
};

/**
 * Name search within a board, bounded to {@link SEARCH_LIMIT} matches.
 *
 * The response is an OBJECT, not a bare array, so truncation can be stated.
 * Previously this returned 50 items that were indistinguishable from a
 * complete result set, which let a client conclude a 163-item board had 50
 * items. It now over-fetches one row: `truncated` is true only when a
 * genuine 51st match exists, so a result that exactly fills the limit is
 * still reported as complete.
 */
export async function searchItemsHandler(
  getClient: GetClient,
  input: { boardId: string; query: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from("items")
    .select("id, name, group_id")
    .eq("board_id", input.boardId)
    .is("archived_at", null)
    .ilike("name", `%${input.query}%`)
    .order("position", { ascending: true })
    .limit(SEARCH_LIMIT + 1);
  if (error) {
    return {
      content: [{ type: "text" as const, text: error.message }],
      isError: true,
    };
  }
  const rows = data ?? [];
  const truncated = rows.length > SEARCH_LIMIT;
  const items = rows.slice(0, SEARCH_LIMIT).map((i) => ({
    id: i.id,
    name: i.name,
    groupId: i.group_id,
  }));
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          items,
          truncated,
          ...(truncated
            ? {
                note: `More than ${SEARCH_LIMIT} items match — only the first ${SEARCH_LIMIT} are shown. Narrow the query, or use list_items to page through the whole board.`,
              }
            : {}),
        }),
      },
    ],
  };
}

export const searchItemsDescriptor: ToolDescriptor = {
  name: "search_items",
  title: "Search items",
  description: `Search items by name within a board (bounded to ${SEARCH_LIMIT} results).`,
  inputSchema: searchItemsInput,
  capability: null,
  scope: "boardId",
  invoke: (ctx, input) =>
    searchItemsHandler(
      ctx.getClient,
      input as { boardId: string; query: string },
    ),
};
