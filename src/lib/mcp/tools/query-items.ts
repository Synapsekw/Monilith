import * as z from "zod";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import {
  listOrgMemberProfiles,
  resolveOrgForScope,
  type OrgMemberProfile,
} from "@/lib/mcp/org-scope";
import { todayInTimeZone } from "@/lib/focus/today";
import { effectiveTimeZone } from "@/lib/datetime/timezone";
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
  // "me", "unassigned", a user id, or a person's name (resolved in the handler
  // against the org's members, so a name never silently matches nothing).
  assignee: z.string().trim().min(1).max(200).optional(),
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
const MAX_LISTED_MEMBERS = 20;
const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
const normName = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
const describeMember = (p: OrgMemberProfile) =>
  `${JSON.stringify(p.fullName ?? "Unnamed member")} (user id ${p.userId})`;

/**
 * A person's name → the one org member it means (review I4). Case and extra
 * spaces are ignored. An exact full-name match wins; otherwise a name that a
 * member's name starts a word with ("Ana" for "Ana Kovac"). Several matches,
 * or none, is an error that lists the candidates: the caller asks the user or
 * passes the user id, and never gets a guess or a silent empty list.
 */
export function resolveAssigneeName(
  members: OrgMemberProfile[],
  name: string,
): { userId: string } | { error: string } {
  const term = normName(name);
  const named = members.filter((m) => m.fullName);
  const exact = named.filter((m) => normName(m.fullName!) === term);
  const matches =
    exact.length > 0
      ? exact
      : named.filter((m) => ` ${normName(m.fullName!)}`.includes(` ${term}`));
  if (matches.length === 1) return { userId: matches[0]!.userId };
  if (matches.length > 1)
    return {
      error: `More than one member matches ${JSON.stringify(name.trim())}: ${matches
        .slice(0, MAX_LISTED_MEMBERS)
        .map(describeMember)
        .join(
          ", ",
        )}. Ask which one is meant, then pass that user id as assignee.`,
    };
  const listed = named.slice(0, MAX_LISTED_MEMBERS).map(describeMember);
  return {
    error: `No member of this organization is named ${JSON.stringify(name.trim())}.${
      listed.length
        ? ` Members: ${listed.join(", ")}${named.length > listed.length ? ", and others" : ""}.`
        : ""
    }`,
  };
}

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
    const scope = await resolveOrgForScope(supabase, {
      orgId: args.orgId,
      boardId: args.boardId,
      folderId: args.folderId,
    });
    if ("error" in scope) return err(scope.error);

    let dueTo = args.dueTo ?? null;
    let timezoneAssumed = false;
    if (args.overdue) {
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", actorId)
        .maybeSingle();
      if (profileErr) return err(profileErr.message);
      const day = todayInTimeZone(
        effectiveTimeZone(profile?.timezone, scope.org.timezone),
        now,
      );
      const today = day.today;
      timezoneAssumed = day.timezoneAssumed;
      dueTo = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS)
        .toISOString()
        .slice(0, 10);
    }

    // Names label people in listings and assignee counts, and resolve an
    // assignee given as a name. Loaded once.
    // Keywords are case-insensitive: "Me" must never fall through to the name
    // match, where it would hit any member whose name starts with "me".
    const rawAssignee = args.assignee?.trim();
    const assigneeKeyword = rawAssignee?.toLowerCase();
    const assignee =
      assigneeKeyword === "me" || assigneeKeyword === "unassigned"
        ? assigneeKeyword
        : rawAssignee;
    const byName =
      !!assignee &&
      assignee !== "me" &&
      assignee !== "unassigned" &&
      !isUuid(assignee);
    const needsNames = !args.countBy || args.countBy === "assignee";
    const profiles =
      needsNames || byName
        ? await listOrgMemberProfiles(supabase, scope.org.id)
        : [];
    let assigneeId: string | null = null;
    if (assignee === "me") assigneeId = actorId;
    else if (byName) {
      const hit = resolveAssigneeName(profiles, assignee);
      if ("error" in hit) return err(hit.error);
      assigneeId = hit.userId;
    } else if (assignee && assignee !== "unassigned") assigneeId = assignee;

    const filters = {
      p_org_id: scope.org.id,
      p_board_id: args.boardId ?? null,
      p_folder_id: args.folderId ?? null,
      p_group_id: args.groupId ?? null,
      p_assignee: assigneeId,
      p_unassigned: assignee === "unassigned",
      p_state: args.overdue ? "open" : (args.state ?? "open"),
      p_due_from: args.dueFrom ?? null,
      p_due_to: dueTo,
      p_updated_since: args.updatedSince ?? null,
    };

    const names = nameMap(profiles);
    const assumed = timezoneAssumed ? { timezoneAssumed: true } : {};

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
            text: JSON.stringify({ countBy: args.countBy, counts, ...assumed }),
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
    // `offset` is capped at QUERY_MAX_OFFSET, so a longer list cannot be paged
    // to the end: say so rather than stopping silently.
    const more =
      shown < total
        ? shown <= QUERY_MAX_OFFSET
          ? { nextOffset: shown }
          : {
              truncated: true,
              note: `Only the first ${shown} of ${total} matching items can be paged. Narrow the filter (a board, a date window, an assignee) to see the rest.`,
            }
        : {};
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            total,
            items,
            ...more,
            ...assumed,
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
  description: `Filtered read of items across one board (boardId), one project folder (folderId) or the whole organization. Filters: assignee ("me", "unassigned", a user id, or a person's name such as "Ana" or "Ana Kovac"; a name that matches several members or none returns the candidates with their user ids, so ask which one is meant), state (open by default, done, any), overdue, dueFrom/dueTo, updatedSince, groupId. Sort by due date (default) or last change. Returns at most ${QUERY_LIMIT} items plus \`total\`, the number of items matching the filter; pass \`nextOffset\` back as \`offset\` for more (paging stops at offset ${QUERY_MAX_OFFSET}; then \`truncated\` is set, so narrow the filter). Set countBy (board, assignee or status) to get counts instead of items, which is the right call for "how many" and "how is it spread" questions. Assignee counts count an item once per assignee, so they can add up to more than \`total\`; unassigned items are counted under "Unassigned". Status counts merge statuses with the same name across boards. Counts list at most 100 groups. Prefer this over paging list_items.`,
  inputSchema: input,
  capability: null,
  scope: "none",
  invoke: (ctx, raw) =>
    queryItemsHandler(ctx.getClient, ctx.actorId, raw as QueryItemsArgs),
};
