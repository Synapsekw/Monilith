import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "./shared";

const getItemInput = { itemId: z.string().uuid() };

export async function getItemHandler(
  getClient: GetClient,
  input: { itemId: string },
) {
  const supabase = await getClient();
  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("id, name, group_id, board_id, position")
    .eq("id", input.itemId)
    .maybeSingle();
  if (itemErr || !item) {
    return {
      content: [{ type: "text" as const, text: "Item not found." }],
      isError: true,
    };
  }
  const { data: cells, error: cellErr } = await supabase
    .from("cell_values")
    .select("column_id, value")
    .eq("item_id", input.itemId);
  if (cellErr) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to fetch cell values: ${cellErr.message}`,
        },
      ],
      isError: true,
    };
  }
  const cellValues = (cells ?? []).map((c) => ({
    columnId: c.column_id,
    value: c.value,
  }));
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ item, cellValues }) },
    ],
  };
}

export function registerGetItemTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_item",
    {
      title: "Get item",
      description: "Get an item's fields and cell values.",
      inputSchema: getItemInput,
    },
    async (input) => getItemHandler(getClient, input),
  );
}
