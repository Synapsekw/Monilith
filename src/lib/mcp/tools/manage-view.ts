import { z } from "zod";
import {
  createBoardViewCore,
  updateBoardViewCore,
  deleteBoardViewCore,
} from "@/lib/boards/core/view";
import {
  parseAction,
  toToolResult,
  type GetClient,
  type ToolResult,
} from "./shared";
import type { ToolDescriptor } from "./descriptor";

const viewKind = z.enum(["table", "kanban", "calendar", "timeline"]);

/**
 * The real, per-action shape — a discriminated union `parseAction` checks
 * AFTER the raw `inputSchema` below has already let the call through. See
 * `parseAction`'s doc comment for why both layers exist.
 */
const manageViewAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    boardId: z.string().uuid(),
    kind: viewKind,
    name: z.string().trim().min(1).max(100).optional(),
  }),
  z.object({
    action: z.literal("update"),
    viewId: z.string().uuid(),
    name: z.string().trim().min(1).max(100).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    action: z.literal("delete"),
    viewId: z.string().uuid(),
  }),
]);

/**
 * `inputSchema`'s raw shape. `action` MUST be a `z.enum` listing every action
 * — the board-scope guard (`board-scope-guard.ts`) falls back to scope
 * `"none"` for an action it does not recognise, and `"none"` escapes
 * board-scope narrowing entirely. Every other field is optional here because
 * which ones are required depends on `action`; `manageViewAction` above is
 * what actually enforces that.
 */
const manageViewInput = {
  action: z.enum(["create", "update", "delete"]),
  boardId: z.string().uuid().optional(),
  viewId: z.string().uuid().optional(),
  kind: viewKind.optional(),
  name: z.string().trim().min(1).max(100).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
};

export async function manageViewHandler(
  getClient: GetClient,
  raw: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parseAction(manageViewAction, raw);
  if (!parsed.ok) return parsed.result;

  const supabase = await getClient();

  switch (parsed.value.action) {
    case "create":
      return toToolResult(
        await createBoardViewCore(supabase, {
          boardId: parsed.value.boardId,
          kind: parsed.value.kind,
          name: parsed.value.name,
        }),
      );
    case "update":
      return toToolResult(
        await updateBoardViewCore(supabase, {
          viewId: parsed.value.viewId,
          name: parsed.value.name,
          config: parsed.value.config,
        }),
      );
    case "delete":
      return toToolResult(
        await deleteBoardViewCore(supabase, { viewId: parsed.value.viewId }),
      );
  }
}

/**
 * `manage_view` — create, update or delete a board view. All behaviour lives
 * in the three `*BoardViewCore` functions (`@/lib/boards/core/view`), which
 * the `createBoardView`/`updateBoardView`/`deleteBoardView` Server Actions
 * call too, so this tool cannot drift from the UI path.
 *
 * `create` addresses an EXISTING board (`boardId` is required and scoped),
 * so — unlike a tool that mints a new top-level object — it needs no
 * `unscopedCreateActions` entry.
 */
export const manageViewDescriptor: ToolDescriptor = {
  name: "manage_view",
  title: "Manage view",
  description:
    "Create, update or delete a board view: table, kanban, calendar, or " +
    "timeline. Each kind has its own `config` shape (e.g. kanban's " +
    "group_column_id, calendar's date_column_id) — call describe_schema " +
    "for the per-kind fields before setting `config` on update.",
  inputSchema: manageViewInput,
  capability: {
    create: "board.structure",
    update: "board.structure",
    delete: "board.destroy",
  },
  scope: { create: "boardId", update: "viewId", delete: "viewId" },
  invoke: (ctx, input) => manageViewHandler(ctx.getClient, input),
};
