import { z } from "zod";
import type { ToolDescriptor } from "./descriptor";
import { parseAction, toToolResult } from "./shared";
import {
  archiveGroupCore,
  createGroupsCore,
  recolorGroupCore,
  renameGroupCore,
  reorderGroupCore,
  restoreGroupCore,
} from "@/lib/boards/core/group";

const uuid = z.string().uuid();
// Matches the Server Action's `createGroupSchema`/`renameGroupSchema` bound
// (`src/lib/validations/board-actions.ts`).
const groupName = z.string().trim().min(1).max(100);
// Matches `updateGroupColorSchema`.
const groupColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid color");

/** The real validation. Applied inside `invoke` because `inputSchema` must be
 *  a raw shape for `registerTool`, and a discriminated union is not one. */
const manageGroupArgs = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    boardId: uuid,
    groups: z
      .array(z.object({ name: groupName }))
      .min(1)
      .max(50),
  }),
  z.object({ action: z.literal("rename"), groupId: uuid, name: groupName }),
  z.object({
    action: z.literal("reorder"),
    groupId: uuid,
    position: z.number().finite(),
  }),
  z.object({
    action: z.literal("recolor"),
    groupId: uuid,
    color: groupColor,
  }),
  z.object({ action: z.literal("archive"), groupId: uuid }),
  z.object({ action: z.literal("restore"), groupId: uuid }),
]);

/** What the SDK sees. `action` is an enum so a misspelling — or an action this
 *  tool deliberately does not expose, like "delete" — is rejected before the
 *  handler ever runs (see manage-board.ts for why the enum is load-bearing).
 *  The per-action fields are optional here and required by the union above. */
const manageGroupInput = {
  action: z.enum([
    "create",
    "rename",
    "reorder",
    "recolor",
    "archive",
    "restore",
  ]),
  boardId: uuid.optional(),
  groupId: uuid.optional(),
  groups: z
    .array(z.object({ name: groupName }))
    .max(50)
    .optional(),
  name: groupName.optional(),
  position: z.number().finite().optional(),
  color: groupColor.optional(),
};

export const manageGroupDescriptor: ToolDescriptor = {
  name: "manage_group",
  title: "Manage group",
  description:
    "Create one or more groups on a board, or rename, reorder, recolor, " +
    "archive or restore an existing group. Archiving a group also archives " +
    "its live items and is reversible with restore; there is no permanent " +
    "delete — ask a person to empty the Trash.",
  inputSchema: manageGroupInput,
  capability: {
    create: "board.structure",
    rename: "board.structure",
    reorder: "board.structure",
    recolor: "board.structure",
    restore: "board.structure",
    archive: "board.destroy",
  },
  // `unscopedCreateActions` is deliberately omitted here: unlike
  // `manage_board`'s `create` (which addresses no existing board),
  // `manage_group`'s `create` always takes a `boardId` and so is caught by
  // ordinary scope resolution below.
  scope: {
    create: "boardId",
    rename: "groupId",
    reorder: "groupId",
    recolor: "groupId",
    restore: "groupId",
    archive: "groupId",
  },
  invoke: async (ctx, input) => {
    const parsed = parseAction(manageGroupArgs, input);
    if (!parsed.ok) return parsed.result;
    const args = parsed.value;
    const supabase = await ctx.getClient();

    switch (args.action) {
      case "create":
        return toToolResult(await createGroupsCore(supabase, args));
      case "rename":
        return toToolResult(await renameGroupCore(supabase, args));
      case "reorder":
        return toToolResult(await reorderGroupCore(supabase, args));
      case "recolor":
        return toToolResult(await recolorGroupCore(supabase, args));
      case "archive":
        return toToolResult(await archiveGroupCore(supabase, args));
      case "restore":
        return toToolResult(await restoreGroupCore(supabase, args));
    }
  },
};
