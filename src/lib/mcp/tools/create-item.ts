import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database.types";
import { cellValueSchema } from "@/lib/validations/boards";

type GetClient = () => Promise<SupabaseClient<Database>>;

const fieldInput = z.object({
  columnId: z.string().uuid(),
  value: z.record(z.string(), z.unknown()),
});
const createItemInput = {
  groupId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  fields: z.array(fieldInput).max(50).optional(),
};

/** Writes one cell value, mirroring the guard logic in src/lib/boards/actions/cell.ts's upsertCell. */
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

  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("board_id")
    .eq("id", itemId)
    .maybeSingle();
  if (itemErr || !item) return "Item not found.";
  if (item.board_id !== column.board_id)
    return "Item and column belong to different boards.";

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

export async function createItemHandler(
  getClient: GetClient,
  input: {
    groupId: string;
    name: string;
    fields?: { columnId: string; value: Record<string, unknown> }[];
  },
) {
  const supabase = await getClient();
  const { data: item, error } = await supabase.rpc("create_item", {
    p_group_id: input.groupId,
    p_name: input.name,
  });
  if (error || !item) {
    return {
      content: [
        {
          type: "text" as const,
          text: error?.message ?? "Could not create item.",
        },
      ],
      isError: true,
    };
  }
  const fieldErrors: string[] = [];
  for (const field of input.fields ?? []) {
    const err = await writeCellValue(supabase, item.id, field);
    if (err) fieldErrors.push(`${field.columnId}: ${err}`);
  }
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ item, fieldErrors }) },
    ],
    isError:
      fieldErrors.length > 0 &&
      fieldErrors.length === (input.fields?.length ?? 0)
        ? true
        : undefined,
  };
}

export function registerCreateItemTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "create_item",
    {
      title: "Create item",
      description:
        "Create a new item in a group, optionally setting initial field values.",
      inputSchema: createItemInput,
    },
    async (input) => createItemHandler(getClient, input),
  );
}
