import { z } from "zod";
import {
  fieldInput,
  writeCellValue,
  type FieldInput,
  type GetClient,
} from "./shared";
import type { ToolDescriptor } from "./descriptor";

const updateItemInput = {
  itemId: z.string().uuid(),
  name: z.string().trim().min(1).max(255).optional(),
  fields: z.array(fieldInput).max(50).optional(),
};

export async function updateItemHandler(
  getClient: GetClient,
  input: {
    itemId: string;
    name?: string;
    fields?: FieldInput[];
  },
  actorId: string,
) {
  const supabase = await getClient();

  if (input.name) {
    const { data, error } = await supabase
      .from("items")
      .update({ name: input.name })
      .eq("id", input.itemId)
      .select("board_id")
      .maybeSingle();
    if (error || !data) {
      return {
        content: [
          { type: "text" as const, text: error?.message ?? "Item not found." },
        ],
        isError: true,
      };
    }
  }

  const fieldErrors: string[] = [];
  for (const field of input.fields ?? []) {
    const err = await writeCellValue(supabase, input.itemId, field, actorId);
    if (err) fieldErrors.push(`${field.columnId}: ${err}`);
  }
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ itemId: input.itemId, fieldErrors }),
      },
    ],
    isError:
      fieldErrors.length > 0 &&
      fieldErrors.length === (input.fields?.length ?? 0)
        ? true
        : undefined,
  };
}

type UpdateItemArgs = { itemId: string; name?: string; fields?: FieldInput[] };

export const updateItemDescriptor: ToolDescriptor = {
  name: "update_item",
  title: "Update item",
  description:
    "Rename an item and/or update its field values. No delete/archive/move.",
  inputSchema: updateItemInput,
  capability: "board.write",
  scope: "itemId",
  invoke: (ctx, input) =>
    updateItemHandler(ctx.getClient, input as UpdateItemArgs, ctx.actorId),
};
