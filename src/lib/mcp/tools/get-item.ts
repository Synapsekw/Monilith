import { z } from "zod";
import type { GetClient } from "./shared";
import type { ToolDescriptor } from "./descriptor";

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

export const getItemDescriptor: ToolDescriptor = {
  name: "get_item",
  title: "Get item",
  description: "Get an item's fields and cell values.",
  inputSchema: getItemInput,
  capability: null,
  scope: "itemId",
  invoke: (ctx, input) =>
    getItemHandler(ctx.getClient, input as { itemId: string }),
};
