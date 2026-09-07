import { z } from "zod";
import {
  addSubitemCore,
  archiveItemCore,
  restoreItemCore,
  reorderItemCore,
  moveItemCore,
} from "@/lib/boards/core/item";
import { toToolResult, parseAction, type GetClient } from "./shared";
import type { ToolDescriptor } from "./descriptor";

/**
 * Every action `manage_item` dispatches. This list is THE enum on the raw
 * `action` input field below — load-bearing, not stylistic: `scopeFor` in
 * `board-scope-guard.ts` falls back to scope `"none"` for an action it does
 * not recognise, and `"none"` escapes board-scope narrowing entirely. An
 * unenumerated action must therefore be unreachable at the schema layer, not
 * merely absent from the switch.
 */
const MANAGE_ITEM_ACTIONS = [
  "archive",
  "restore",
  "move",
  "reorder",
  "add_subitem",
] as const;

/** MCP's raw-shape form — every field any action might carry, each optional
 *  except `action` itself. The real per-action requirements are enforced by
 *  `manageItemArgs` below, applied as the first statement of `invoke`. */
const manageItemInput = {
  action: z.enum(MANAGE_ITEM_ACTIONS),
  itemId: z.string().uuid(),
  groupId: z.string().uuid().optional(),
  position: z.number().optional(),
  name: z.string().trim().min(1).max(255).optional(),
};

const manageItemArgs = z.discriminatedUnion("action", [
  z.object({ action: z.literal("archive"), itemId: z.string().uuid() }),
  z.object({ action: z.literal("restore"), itemId: z.string().uuid() }),
  z.object({
    action: z.literal("move"),
    itemId: z.string().uuid(),
    groupId: z.string().uuid(),
    position: z.number().optional(),
  }),
  z.object({
    action: z.literal("reorder"),
    itemId: z.string().uuid(),
    position: z.number(),
  }),
  z.object({
    // The parent's id, named after the tool's scope value (`scope: "itemId"`)
    // rather than `parentId` — see the descriptor contract note below.
    action: z.literal("add_subitem"),
    itemId: z.string().uuid(),
    name: z.string().trim().min(1).max(255),
  }),
]);

export async function manageItemHandler(
  getClient: GetClient,
  input: Record<string, unknown>,
) {
  const parsed = parseAction(manageItemArgs, input);
  if (!parsed.ok) return parsed.result;

  // Called exactly ONCE per invocation, before dispatch — never inside the
  // switch or a loop. Each call charges the MCP rate limit and rotates the
  // OAuth bridge secret (shared.ts).
  const supabase = await getClient();

  const args = parsed.value;
  switch (args.action) {
    case "archive":
      return toToolResult(
        await archiveItemCore(supabase, { itemId: args.itemId }),
      );
    case "restore":
      return toToolResult(
        await restoreItemCore(supabase, { itemId: args.itemId }),
      );
    case "move":
      return toToolResult(
        await moveItemCore(supabase, {
          itemId: args.itemId,
          groupId: args.groupId,
          position: args.position,
        }),
      );
    case "reorder":
      return toToolResult(
        await reorderItemCore(supabase, {
          itemId: args.itemId,
          position: args.position,
        }),
      );
    case "add_subitem":
      // The descriptor's scope contract is that the input field is named
      // after the scope value — `scope: "itemId"` means `input.itemId`, and
      // both `board-scope-guard.ts` and `proposal-targets.ts` rely on that.
      // `add_subitem`'s `itemId` names the PARENT; map it onto the core's
      // `parentId` here, at the one place that has to know both names.
      return toToolResult(
        await addSubitemCore(supabase, {
          parentId: args.itemId,
          name: args.name,
        }),
      );
  }
}

export const manageItemDescriptor: ToolDescriptor = {
  name: "manage_item",
  title: "Manage item",
  description:
    "Archive, restore, move, reorder an item, or add a subitem under it. " +
    "Archiving moves an item to Trash and is reversible with restore; there " +
    "is no permanent delete. Moving an item carries its subitems with it.",
  inputSchema: manageItemInput,
  capability: {
    archive: "board.destroy",
    restore: "board.structure",
    move: "board.structure",
    reorder: "board.structure",
    add_subitem: "board.structure",
  },
  scope: {
    archive: "itemId",
    restore: "itemId",
    move: "itemId",
    reorder: "itemId",
    add_subitem: "itemId",
  },
  invoke: (ctx, input) => manageItemHandler(ctx.getClient, input),
};
