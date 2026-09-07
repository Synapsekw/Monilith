import { z } from "zod";
import {
  fieldInput,
  writeCellValue,
  type FieldInput,
  type GetClient,
  type ToolResult,
} from "./shared";
import type { ToolDescriptor } from "./descriptor";
import type { BatchResult } from "@/lib/boards/core/batch";
import type { Tables } from "@/types/database.types";

const itemEntry = z.object({
  name: z.string().trim().min(1).max(255),
  fields: z.array(fieldInput).max(50).optional(),
});

const createItemInput = {
  groupId: z.string().uuid(),
  /** The original single-item form. Unchanged — shipped clients use it. */
  name: z.string().trim().min(1).max(255).optional(),
  fields: z.array(fieldInput).max(50).optional(),
  /** The batch form. Supply this OR name, never both. */
  items: z.array(itemEntry).min(1).max(50).optional(),
};

type ItemEntry = { name: string; fields?: FieldInput[] };

export type CreateItemInput = {
  groupId: string;
  /** The original single-item form. Unchanged — shipped clients use it. */
  name?: string;
  fields?: FieldInput[];
  /** The batch form. Supply this OR name, never both. */
  items?: ItemEntry[];
};

const BATCH_CAP = 50;

/**
 * The cross-field invariant a `ZodRawShape` cannot express — "exactly one of
 * `name` or `items`", and the batch cap — applied as the first statement of
 * the handler (see `parseAction`'s doc comment in `shared.ts` for the same
 * pattern on a grouped-dispatch tool). This deliberately does NOT re-validate
 * per-field shape (uuid format, string length, …): that is the raw
 * `createItemInput` schema's job at the real MCP/AI SDK transport boundary,
 * and re-doing it here would force every existing unit test to switch to
 * schema-valid fixtures for a batch feature that does not touch them.
 */
function validateForm(input: CreateItemInput): string | null {
  if ((input.name === undefined) === (input.items === undefined)) {
    return "Supply either name (one item) or items (a batch), not both.";
  }
  if (input.items && input.items.length > BATCH_CAP) {
    return `A batch is limited to ${BATCH_CAP} items.`;
  }
  return null;
}

type CreatedEntry = { item: Tables<"items">; fieldErrors: string[] };

export async function createItemHandler(
  getClient: GetClient,
  input: CreateItemInput,
  actorId: string,
): Promise<ToolResult> {
  const invalid = validateForm(input);
  if (invalid) {
    return { content: [{ type: "text", text: invalid }], isError: true };
  }

  // Called exactly ONCE for the whole call — including a batch of up to 50
  // entries. Never inside the per-entry loop below.
  const supabase = await getClient();

  // Normalize to a single list before the loop, so the single form cannot
  // drift from the batch form over time: one code path handles both.
  const entries = input.items ?? [{ name: input.name!, fields: input.fields }];

  const created: CreatedEntry[] = [];
  const errors: BatchResult<CreatedEntry>["errors"] = [];

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    const { data: item, error } = await supabase.rpc("create_item", {
      p_group_id: input.groupId,
      p_name: entry.name,
    });
    if (error || !item) {
      errors.push({ index, error: error?.message ?? "Could not create item." });
      continue;
    }
    const fieldErrors: string[] = [];
    for (const field of entry.fields ?? []) {
      const err = await writeCellValue(supabase, item.id, field, actorId);
      if (err) fieldErrors.push(`${field.columnId}: ${err}`);
    }
    created.push({ item, fieldErrors });
  }

  // The batch form: `{ created, errors }`, isError only when every entry
  // failed — a partial success is a success with a report attached.
  if (input.items !== undefined) {
    return {
      content: [{ type: "text", text: JSON.stringify({ created, errors }) }],
      isError: errors.length === entries.length ? true : undefined,
    };
  }

  // The original single-item form: a caller that sent the old input gets the
  // old output, byte-for-byte.
  if (created.length === 0) {
    return {
      content: [{ type: "text", text: errors[0]!.error }],
      isError: true,
    };
  }
  const { item, fieldErrors } = created[0]!;
  return {
    content: [{ type: "text", text: JSON.stringify({ item, fieldErrors }) }],
    isError:
      fieldErrors.length > 0 &&
      fieldErrors.length === (entries[0]!.fields?.length ?? 0)
        ? true
        : undefined,
  };
}

export const createItemDescriptor: ToolDescriptor = {
  name: "create_item",
  title: "Create item",
  description:
    "Create a new item in a group, optionally setting initial field values. " +
    "Pass `name` (and optional `fields`) for a single item, or `items` — a " +
    "list of up to 50 `{name, fields?}` entries — to create a batch in one call.",
  inputSchema: createItemInput,
  capability: "board.write",
  scope: "groupId",
  invoke: (ctx, input) =>
    createItemHandler(ctx.getClient, input as CreateItemInput, ctx.actorId),
};
