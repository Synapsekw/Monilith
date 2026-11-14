import * as z from "zod";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { listOrgMemberProfiles, resolveOrgForTool } from "@/lib/mcp/org-scope";
import { todayInTimeZone } from "@/lib/focus/today";
import type { GetClient, ToolResult } from "./shared";
import type { ToolDescriptor } from "./descriptor";
import { nameMap, personName } from "./names";

export const QUERY_LIMIT = 50;
export const QUERY_MAX_OFFSET = 1000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use `YYYY-MM-DD`.");

const input = {
  orgId: z.string().uuid().optional(),
  boardId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  assignee: z
    .union([z.literal("me"), z.literal("unassigned"), z.string().uuid()])
    .optional(),
  state: z.enum(["open", "done", "any"]).optional(),
  overdue: z.boolean().optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  updatedSince: z.string().datetime({ offset: true }).optional(),
  sort: z.enum(["due", "updated"]).optional(),
  limit: z.number().int().min(1).max(QUERY_LIMIT).optional(),
  offset: z.number().int().min(0).max(QUERY_MAX_OFFSET).optional(),
  countBy: z.enum(["board", "assignee", "status"]).optional(),
};

export type QueryItemsArgs = {
  orgId?: string;
  boardId?: string;
  folderId?: string;
  groupId?: string;
  assignee?: string;
  state?: "open" | "done" | "any";
  overdue?: boolean;
  dueFrom?: string;
  dueTo?: string;
  updatedSince?: string;
  sort?: "due" | "updated";
  limit?: number;
  offset?: number;
  countBy?: "board" | "assignee" | "status";
};

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

const DAY_MS = 86_400_000;

export async function queryItemsHandler(
  getClient: GetClient,
  actorId: string,
  args: QueryItemsArgs,
  now: number = Date.now(),
): Promise<ToolResult> {
  // Guards BEFORE getClient(): a malformed call must not charge the rate limit.
  if (args.boardId && args.folderId)
    return err("Pass boardId or folderId, not both.");
  if (args.groupId && !args.boardId) return err("groupId needs boardId.");
  if (args.overdue && (args.dueFrom || args.dueTo))
    return err("Pass `overdue` or a due window, not both.");
  if (args.overdue && args.state && args.state !== "open")
    return err("`overdue` only applies to open items.");

  const supabase = await getClient();
  try {
    const scope = await resolveOrgForTool(supabase, args.orgId);
    if ("error" in scope) return err(scope.error);

    let dueTo = args.dueTo ?? null;
    if (args.overdue) {
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", actorId)
        .maybeSingle();
      if (profileErr) return err(profileErr.message);
      const { today } = todayInTimeZone(profile?.timezone ?? null, now);
      dueTo = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS)
        .toISOString()
        .slice(0, 10);
    }

    const filters = {
      p_org_id: scope.org.id,
      p_board_id: args.boardId ?? null,
      p_folder_id: args.folderId ?? null,
      p_group_id: args.groupId ?? null,
      p_assignee:
        args.assignee === "me"
          ? actorId
          : args.assignee && args.assignee !== "unassigned"
            ? args.assignee
            : null,
      p_unassigned: args.assignee === "unassigned",
      p_state: args.overdue ? "open" : (args.state ?? "open"),
      p_due_from: args.dueFrom ?? null,
      p_due_to: dueTo,
      p_updated_since: args.updatedSince ?? null,
    };

    const names = nameMap(await listOrgMemberProfiles(supabase, scope.org.id));

    if (args.countBy) {
      const { data, error } = await typedRpc(supabase, "count_items", {
        ...filters,
        p_count_by: args.countBy,
      });
      if (error) return err(error.message);
      const counts = (data ?? []).map((r) => ({
        label:
          args.countBy === "assignee"
            ? r.key === ""
              ? "Unassigned"
              : personName(names, r.key)
            : (r.label ?? r.key),
        count: r.item_count,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ countBy: args.countBy, counts }),
          },
        ],
      };
    }

    const limit = args.limit ?? QUERY_LIMIT;
    const offset = args.offset ?? 0;
    const { data, error } = await typedRpc(supabase, "query_items", {
      ...filters,
      p_sort: args.sort ?? "due",
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return err(error.message);
    const rows = data ?? [];
    const total = rows[0]?.total ?? 0;
    const items = rows.map((r) => ({
      id: r.item_id,
      name: r.item_name,
      boardId: r.board_id,
      board: r.board_name,
      group: r.group_name,
      status: r.status_label,
      done: r.is_done,
      dueDate: r.due_date,
      lastChange: r.last_change,
      assignees: (Array.isArray(r.assignee_ids) ? r.assignee_ids : []).map(
        (id) => personName(names, String(id)),
      ),
    }));
    const shown = offset + items.length;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            total,
            items,
            ...(shown < total && shown < QUERY_MAX_OFFSET
              ? { nextOffset: shown }
              : {}),
          }),
        },
      ],
    };
  } catch (e) {
    return err((e as Error).message);
  }
}

export const queryItemsDescriptor: ToolDescriptor = {
  name: "query_items",
  title: "Query items",
  description: `Filtered read of items across one board (boardId), one project folder (folderId) or the whole organization. Filters: assignee ("me", "unassigned" or a user id), state (open by default, done, any), overdue, dueFrom/dueTo, updatedSince, groupId. Sort by due date (default) or last change. Returns at most ${QUERY_LIMIT} items plus \`total\`, the number of items matching the filter; pass \`nextOffset\` back as \`offset\` for more. Set countBy (board, assignee or status) to get counts instead of items, which is the right call for "how many" and "how is it spread" questions. Prefer this over paging list_items.`,
  inputSchema: input,
  capability: null,
  scope: "none",
  invoke: (ctx, raw) =>
    queryItemsHandler(ctx.getClient, ctx.actorId, raw as QueryItemsArgs),
};
