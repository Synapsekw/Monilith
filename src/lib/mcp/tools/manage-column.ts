import { z } from "zod";
import { parseAction, toToolResult } from "./shared";
import type { ToolDescriptor } from "./descriptor";
import { columnKindSchema } from "@/lib/validations/boards";
import {
  createColumnsCore,
  renameColumnCore,
  resizeColumnCore,
  reorderColumnCore,
  updateColumnSettingsCore,
  removeColumnOptionCore,
  deleteColumnCore,
} from "@/lib/boards/core/column";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(100);
const settings = z.record(z.string(), z.unknown());

/**
 * The real per-action validation, applied as the first statement of
 * `invoke`. `action` is a `z.literal` per branch — `discriminatedUnion`
 * narrows the rest of the shape from it, so a `create` call cannot smuggle
 * a `width`, and a `resize` call cannot omit `width`.
 *
 * `columns` is capped at 50 — the same batch-size ceiling `create_item`'s
 * `fields` array uses — so a single call cannot fan out unbounded inserts.
 */
const manageColumnAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    boardId: uuid,
    columns: z
      .array(
        z.object({
          kind: columnKindSchema,
          name: name.optional(),
          // Structural check only; the kind-specific shape is enforced by
          // `columnSettingsSchema(kind)` inside `createColumnsCore`.
          settings: settings.optional(),
        }),
      )
      .min(1)
      .max(50),
  }),
  z.object({ action: z.literal("rename"), columnId: uuid, name }),
  z.object({ action: z.literal("configure"), columnId: uuid, settings }),
  z.object({
    action: z.literal("reorder"),
    columnId: uuid,
    position: z.number(),
  }),
  z.object({
    action: z.literal("resize"),
    columnId: uuid,
    width: z.number().int().min(80).max(1200),
  }),
  z.object({ action: z.literal("delete"), columnId: uuid }),
  z.object({
    action: z.literal("remove_option"),
    columnId: uuid,
    optionId: z.string().min(1),
  }),
]);

/**
 * `McpServer.registerTool` wants a raw `ZodRawShape`, not a discriminated
 * union — see `parseAction`'s doc comment. `action` is a `z.enum` so the
 * transport itself rejects an unrecognised action before `board_scope`
 * narrowing ever sees it (a `"none"`-scope fallback would escape narrowing —
 * the reason this must be an enum, not a bare string). Every other field is
 * the union of what any single action needs; the real shape per action is
 * enforced by `manageColumnAction` above.
 */
const manageColumnInputSchema = {
  action: z.enum([
    "create",
    "rename",
    "configure",
    "reorder",
    "resize",
    "delete",
    "remove_option",
  ]),
  boardId: uuid.optional(),
  columnId: uuid.optional(),
  columns: z
    .array(
      z.object({
        kind: columnKindSchema,
        name: name.optional(),
        settings: settings.optional(),
      }),
    )
    .min(1)
    .max(50)
    .optional(),
  name: name.optional(),
  settings: settings.optional(),
  position: z.number().optional(),
  width: z.number().optional(),
  optionId: z.string().optional(),
};

export const manageColumnDescriptor: ToolDescriptor = {
  name: "manage_column",
  title: "Manage column",
  description:
    "Create, rename, reconfigure, reorder, resize or delete board columns. " +
    "Call describe_schema first to learn the settings each column kind " +
    "accepts — status and dropdown options, relation targets and number " +
    "formats cannot be guessed. Deleting a column also deletes its cell " +
    "values and cannot be undone.",
  inputSchema: manageColumnInputSchema,
  // `create`/`rename`/`configure`/`reorder`/`resize` shape the data model but
  // don't destroy data; `delete` and `remove_option` both discard cell
  // values irrecoverably, so they carry the stricter grant.
  capability: {
    create: "board.structure",
    rename: "board.structure",
    configure: "board.structure",
    reorder: "board.structure",
    resize: "board.structure",
    delete: "board.destroy",
    remove_option: "board.destroy",
  },
  // `create` addresses a board (no column exists yet to key off); every
  // other action addresses an existing column.
  scope: {
    create: "boardId",
    rename: "columnId",
    configure: "columnId",
    reorder: "columnId",
    resize: "columnId",
    delete: "columnId",
    remove_option: "columnId",
  },
  invoke: async (ctx, input) => {
    const parsed = parseAction(manageColumnAction, input);
    if (!parsed.ok) return parsed.result;
    const value = parsed.value;
    const supabase = await ctx.getClient();

    switch (value.action) {
      case "create":
        return toToolResult(
          await createColumnsCore(supabase, {
            boardId: value.boardId,
            columns: value.columns,
          }),
        );
      case "rename":
        return toToolResult(
          await renameColumnCore(supabase, {
            columnId: value.columnId,
            name: value.name,
          }),
        );
      case "configure":
        return toToolResult(
          await updateColumnSettingsCore(supabase, {
            columnId: value.columnId,
            settings: value.settings,
          }),
        );
      case "reorder":
        return toToolResult(
          await reorderColumnCore(supabase, {
            columnId: value.columnId,
            position: value.position,
          }),
        );
      case "resize":
        return toToolResult(
          await resizeColumnCore(supabase, {
            columnId: value.columnId,
            width: value.width,
          }),
        );
      case "delete":
        return toToolResult(
          await deleteColumnCore(supabase, { columnId: value.columnId }),
        );
      case "remove_option":
        return toToolResult(
          await removeColumnOptionCore(supabase, {
            columnId: value.columnId,
            optionId: value.optionId,
          }),
        );
    }
  },
};
