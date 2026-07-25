import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  fieldInput,
  writeCellValue,
  type FieldInput,
  type GetClient,
} from "./shared";

const createItemInput = {
  groupId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  fields: z.array(fieldInput).max(50).optional(),
};

export async function createItemHandler(
  getClient: GetClient,
  input: {
    groupId: string;
    name: string;
    fields?: FieldInput[];
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
