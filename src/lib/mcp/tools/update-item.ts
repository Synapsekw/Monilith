import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { cellValueSchema } from "@/lib/validations/boards";
import type { Json } from "@/types/database.types";

type GetClient = () => Promise<SupabaseClient<Database>>;

const fieldInput = z.object({
  columnId: z.string().uuid(),
  value: z.record(z.string(), z.unknown()),
});
const updateItemInput = {
  itemId: z.string().uuid(),
  name: z.string().trim().min(1).max(255).optional(),
  fields: z.array(fieldInput).max(50).optional(),
};

async function writeCellValue(
  supabase: SupabaseClient<Database>,
  itemId: string,
  field: { columnId: string; value: Record<string, unknown> },
): Promise<string | null> {
  const { data: column, error: colErr } = await supabase
    .from("columns")
    .select("org_id, board_id, kind")
    .eq("id", field.columnId)
    .maybeSingle();
  if (colErr || !column) return `Column ${field.columnId} not found.`;

  const valueParsed = cellValueSchema(column.kind).safeParse(field.value);
  if (!valueParsed.success)
    return valueParsed.error.issues[0]?.message ?? "Invalid value.";

  const { error } = await supabase.from("cell_values").upsert(
    {
      org_id: column.org_id,
      board_id: column.board_id,
      item_id: itemId,
      column_id: field.columnId,
      value: valueParsed.data as Json,
    },
    { onConflict: "item_id,column_id" },
  );
  return error?.message ?? null;
}

export async function updateItemHandler(
  getClient: GetClient,
  input: {
    itemId: string;
    name?: string;
    fields?: { columnId: string; value: Record<string, unknown> }[];
  },
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
    const err = await writeCellValue(supabase, input.itemId, field);
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

export function registerUpdateItemTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "update_item",
    {
      title: "Update item",
      description:
        "Rename an item and/or update its field values. No delete/archive/move.",
      inputSchema: updateItemInput,
    },
    async (input) => updateItemHandler(getClient, input),
  );
}
