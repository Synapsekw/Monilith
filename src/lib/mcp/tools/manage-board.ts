import { z } from "zod";
import type { ToolDescriptor } from "./descriptor";
import { parseAction, toToolResult } from "./shared";
import {
  archiveBoardCore,
  createBoardCore,
  duplicateBoardCore,
  renameBoardCore,
  restoreBoardCore,
} from "@/lib/boards/core/board";

const uuid = z.string().uuid();
// Matches the Server Action's `createBoardSchema`/`renameBoardSchema` bound
// (`src/lib/validations/board-actions.ts`) — the two paths must accept the
// same names.
const boardName = z.string().trim().min(1).max(100);

/** The real validation. Applied inside `invoke` because `inputSchema` must be
 *  a raw shape for `registerTool`, and a discriminated union is not one. */
const manageBoardArgs = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), workspaceId: uuid, name: boardName }),
  z.object({ action: z.literal("rename"), boardId: uuid, name: boardName }),
  z.object({ action: z.literal("archive"), boardId: uuid }),
  z.object({ action: z.literal("restore"), boardId: uuid }),
  z.object({ action: z.literal("duplicate"), boardId: uuid }),
]);

/** What the SDK sees. `action` is an enum so a misspelling — or an action this
 *  tool deliberately does not expose, like "delete" — is rejected before the
 *  handler ever runs (descriptor.ts's board-scope guard falls back to "none"
 *  for an action it doesn't recognise, and "none" escapes board-scope
 *  narrowing, so this enum is load-bearing). The per-action fields are
 *  optional here and required by the union above. */
const manageBoardInput = {
  action: z.enum(["create", "rename", "archive", "restore", "duplicate"]),
  boardId: uuid.optional(),
  workspaceId: uuid.optional(),
  name: boardName.optional(),
};

export const manageBoardDescriptor: ToolDescriptor = {
  name: "manage_board",
  title: "Manage board",
  description:
    "Create, rename, duplicate, archive or restore a board. Archiving moves a " +
    "board to Trash and is reversible with restore; there is no permanent " +
    "delete — ask a person to empty the Trash.",
  inputSchema: manageBoardInput,
  capability: {
    create: "board.structure",
    rename: "board.structure",
    duplicate: "board.structure",
    restore: "board.structure",
    archive: "board.destroy",
  },
  scope: {
    create: "none",
    rename: "boardId",
    duplicate: "boardId",
    restore: "boardId",
    archive: "boardId",
  },
  unscopedCreateActions: ["create"],
  invoke: async (ctx, input) => {
    const parsed = parseAction(manageBoardArgs, input);
    if (!parsed.ok) return parsed.result;
    const args = parsed.value;
    const supabase = await ctx.getClient();

    switch (args.action) {
      case "create":
        return toToolResult(await createBoardCore(supabase, args));
      case "rename":
        return toToolResult(await renameBoardCore(supabase, args));
      case "duplicate":
        return toToolResult(
          await duplicateBoardCore(supabase, ctx.actorId, args),
        );
      case "archive":
        return toToolResult(
          await archiveBoardCore(supabase, ctx.actorId, args),
        );
      case "restore":
        return toToolResult(
          await restoreBoardCore(supabase, ctx.actorId, args),
        );
    }
  },
};
