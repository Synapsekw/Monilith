import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type GetClient = () => Promise<SupabaseClient<Database>>;

const SEARCH_LIMIT = 50;

const searchItemsInput = {
  boardId: z.string().uuid(),
  query: z.string().trim().min(1).max(100),
};

export async function searchItemsHandler(
  getClient: GetClient,
  input: { boardId: string; query: string },
) {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from("items")
    .select("id, name, group_id")
    .eq("board_id", input.boardId)
    .is("archived_at", null)
    .ilike("name", `%${input.query}%`)
    .order("position", { ascending: true })
    .limit(SEARCH_LIMIT);
  if (error) {
    return {
      content: [{ type: "text" as const, text: error.message }],
      isError: true,
    };
  }
  const items = (data ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    groupId: i.group_id,
  }));
  return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
}

export function registerSearchItemsTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "search_items",
    {
      title: "Search items",
      description: `Search items by name within a board (bounded to ${SEARCH_LIMIT} results).`,
      inputSchema: searchItemsInput,
    },
    async (input) => searchItemsHandler(getClient, input),
  );
}
