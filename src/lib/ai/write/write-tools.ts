import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getBoardPayload } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { proposedActionSchema, type ValidatedAction } from "./schema";
import {
  resolveCreateItem,
  resolveSetItemFields,
  resolveCreateGroup,
  resolveMoveItem,
  type Member,
} from "./resolve";

export const LIST_MEMBERS_TOOL: Anthropic.Tool = {
  name: "list_board_members",
  description:
    "List members who can be assigned as owners on a board. Returns userId and name. Use this to resolve a person's name to their userId before proposing an owner.",
  input_schema: {
    type: "object",
    properties: {
      board_id: { type: "string", description: "UUID of the board." },
    },
    required: ["board_id"],
    additionalProperties: false,
  },
};

export const WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "propose_create_item",
    description:
      "Propose creating a task/item in a group. Does NOT create it — the user confirms first. Resolve board_id via list_boards, group_id from the `groups` array returned by get_board_overview, and owner userIds via list_board_members before calling.",
    input_schema: {
      type: "object",
      properties: {
        board_id: { type: "string" },
        group_id: { type: "string" },
        name: { type: "string" },
        owner_user_ids: { type: "array", items: { type: "string" } },
        due_date: { type: "string", description: "ISO date YYYY-MM-DD." },
        status_option_id: { type: "string" },
      },
      required: ["board_id", "group_id", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_set_item_fields",
    description:
      "Propose updating an existing item's owner/due date/status. Does NOT write — the user confirms first.",
    input_schema: {
      type: "object",
      properties: {
        board_id: { type: "string" },
        item_id: { type: "string" },
        owner_user_ids: { type: "array", items: { type: "string" } },
        due_date: { type: "string", description: "ISO date YYYY-MM-DD." },
        status_option_id: { type: "string" },
      },
      required: ["board_id", "item_id"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_create_group",
    description:
      "Propose creating a new group (section) on a board. Does NOT write — the user confirms first.",
    input_schema: {
      type: "object",
      properties: { board_id: { type: "string" }, name: { type: "string" } },
      required: ["board_id", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_move_item",
    description:
      "Propose moving an existing item to a different group on the SAME board. Does NOT write — the user confirms first. Resolve group_id from the `groups` array returned by get_board_overview, and item_id via semantic_search_items (which returns item ids). Moving an item to another board is not supported.",
    input_schema: {
      type: "object",
      properties: {
        board_id: { type: "string" },
        item_id: { type: "string" },
        group_id: {
          type: "string",
          description: "UUID of the destination group, on the same board.",
        },
      },
      required: ["board_id", "item_id", "group_id"],
      additionalProperties: false,
    },
  },
];

const err = (message: string) => ({
  content: JSON.stringify({ error: message }),
});

// Map the model's snake_case tool args into the ProposedAction shape, then Zod-parse.
const createItemArgs = z.object({
  board_id: z.string(),
  group_id: z.string(),
  name: z.string(),
  owner_user_ids: z.array(z.string()).optional(),
  due_date: z.string().optional(),
  status_option_id: z.string().optional(),
});
const setFieldsArgs = z.object({
  board_id: z.string(),
  item_id: z.string(),
  owner_user_ids: z.array(z.string()).optional(),
  due_date: z.string().optional(),
  status_option_id: z.string().optional(),
});
const createGroupArgs = z.object({ board_id: z.string(), name: z.string() });
const moveItemArgs = z.object({
  board_id: z.string(),
  item_id: z.string(),
  group_id: z.string(),
});

async function membersFor(orgId: string): Promise<Member[]> {
  const rows = await listOrgMembersCached(orgId);
  // listOrgMembersCached returns OrgMember { userId, fullName, email, avatarUrl }.
  return rows.map((r) => ({ userId: r.userId, name: r.fullName ?? "Unknown" }));
}

/** Build a per-request executor: records proposals, never mutates. Read tools handle name resolution. */
export function createWriteToolExecutor(ctx: {
  orgId: string;
  workspaceId: string;
}) {
  const collected: ValidatedAction[] = [];

  async function listMembers(input: unknown): Promise<{ content: string }> {
    const parsed = z.object({ board_id: z.string() }).safeParse(input);
    if (!parsed.success) return err("invalid tool input");
    const members = await membersFor(ctx.orgId);
    return { content: JSON.stringify(members) };
  }

  async function execute(
    name: string,
    input: unknown,
  ): Promise<{ content: string }> {
    try {
      if (name === "list_board_members") return await listMembers(input);

      if (name === "propose_create_item") {
        const a = createItemArgs.safeParse(input);
        if (!a.success) return err("invalid tool input");
        const parsed = proposedActionSchema.safeParse({
          kind: "create_item",
          boardId: a.data.board_id,
          groupId: a.data.group_id,
          name: a.data.name,
          fields: {
            ownerUserIds: a.data.owner_user_ids,
            dueDate: a.data.due_date,
            statusOptionId: a.data.status_option_id,
          },
        });
        if (!parsed.success)
          return err(parsed.error.issues[0]?.message ?? "invalid");
        const payload = await getBoardPayload(a.data.board_id);
        if (!payload) return err("board not found");
        const r = resolveCreateItem(
          payload,
          await membersFor(ctx.orgId),
          parsed.data as Extract<typeof parsed.data, { kind: "create_item" }>,
        );
        if (r.kind === "error") return err(r.error);
        collected.push(r.action);
        return {
          content: JSON.stringify({
            preview: r.action.summary,
            warnings: r.action.warnings,
          }),
        };
      }

      if (name === "propose_set_item_fields") {
        const a = setFieldsArgs.safeParse(input);
        if (!a.success) return err("invalid tool input");
        const parsed = proposedActionSchema.safeParse({
          kind: "set_item_fields",
          boardId: a.data.board_id,
          itemId: a.data.item_id,
          fields: {
            ownerUserIds: a.data.owner_user_ids,
            dueDate: a.data.due_date,
            statusOptionId: a.data.status_option_id,
          },
        });
        if (!parsed.success)
          return err(parsed.error.issues[0]?.message ?? "invalid");
        const payload = await getBoardPayload(a.data.board_id);
        if (!payload) return err("board not found");
        const r = resolveSetItemFields(
          payload,
          await membersFor(ctx.orgId),
          parsed.data as Extract<
            typeof parsed.data,
            { kind: "set_item_fields" }
          >,
        );
        if (r.kind === "error") return err(r.error);
        collected.push(r.action);
        return {
          content: JSON.stringify({
            preview: r.action.summary,
            warnings: r.action.warnings,
          }),
        };
      }

      if (name === "propose_create_group") {
        const a = createGroupArgs.safeParse(input);
        if (!a.success) return err("invalid tool input");
        const payload = await getBoardPayload(a.data.board_id);
        if (!payload) return err("board not found");
        const r = resolveCreateGroup(payload, {
          kind: "create_group",
          boardId: a.data.board_id,
          name: a.data.name,
        });
        if (r.kind === "error") return err(r.error);
        collected.push(r.action);
        return {
          content: JSON.stringify({
            preview: r.action.summary,
            warnings: r.action.warnings,
          }),
        };
      }

      if (name === "propose_move_item") {
        const a = moveItemArgs.safeParse(input);
        if (!a.success) return err("invalid tool input");
        const parsed = proposedActionSchema.safeParse({
          kind: "move_item",
          boardId: a.data.board_id,
          itemId: a.data.item_id,
          groupId: a.data.group_id,
        });
        if (!parsed.success)
          return err(parsed.error.issues[0]?.message ?? "invalid");
        const payload = await getBoardPayload(a.data.board_id);
        if (!payload) return err("board not found");
        // No `members` argument — a move touches no people column.
        const r = resolveMoveItem(
          payload,
          parsed.data as Extract<typeof parsed.data, { kind: "move_item" }>,
        );
        if (r.kind === "error") return err(r.error);
        collected.push(r.action);
        return {
          content: JSON.stringify({
            preview: r.action.summary,
            warnings: r.action.warnings,
          }),
        };
      }

      return err("unknown tool");
    } catch (e) {
      console.error("[write] tool failed:", name, e);
      return err("tool failed");
    }
  }

  return { execute, collected: () => collected };
}
