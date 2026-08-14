import { z } from "zod";
import type { GetClient, ToolResult } from "./shared";
import type { ToolDescriptor } from "./descriptor";

/** Page size when the caller does not ask for one. Most boards fit in one page. */
export const LIST_ITEMS_DEFAULT_LIMIT = 100;
/** Hard ceiling — working agreement #5: a hot-path read is never unbounded. */
export const LIST_ITEMS_MAX_LIMIT = 200;

export const listItemsInput = {
  boardId: z.string().uuid(),
  groupId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(LIST_ITEMS_MAX_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
};

type ListItemsArgs = {
  boardId: string;
  groupId?: string;
  limit?: number;
  cursor?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Cursor = { position: number; id: string };

/**
 * Keyset cursor over `(position, id)`.
 *
 * `position` alone is NOT unique (`double precision`, and reorders produce
 * ties), so a cursor on it would skip or repeat rows. Pairing it with the
 * primary key makes the sort total and the cursor exact. It is opaque to the
 * caller purely so the shape stays ours to change — it carries no secret.
 */
function encodeCursor(position: number, id: string): string {
  return Buffer.from(`${position}|${id}`, "utf8").toString("base64url");
}

/**
 * Decodes and VALIDATES a cursor. Both halves are interpolated into a
 * PostgREST `or=` predicate, so this is a trust boundary: a finite number and
 * a well-formed uuid are the only things that may reach the filter string.
 * Anything else returns null and the handler refuses the call.
 */
function decodeCursor(raw: string): Cursor | null {
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const sep = decoded.lastIndexOf("|");
  if (sep <= 0) return null;
  const position = Number(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (!Number.isFinite(position) || !UUID_RE.test(id)) return null;
  return { position, id };
}

function toolError(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/**
 * Lists a board's items WITH their cell values in one response.
 *
 * This exists because there was no way to answer "what's on this board?":
 * `get_board` returns no items and `get_item` returns one item per call, so a
 * client had to guess `search_items` substrings and then fan out an N+1 of
 * `get_item` calls — each one charging the MCP rate limit and rotating the
 * OAuth bridge secret (a DB write). A 163-item board took ~164 round trips;
 * it now takes two.
 *
 * Bounded and indexed: the item page filters `board_id` and orders by
 * `position`, served by `items_board_position_live_idx (board_id, position)
 * where archived_at is null`. Cell values for the whole page come from ONE
 * batched `in (item_ids)` read against `cell_values`' primary key
 * `(item_id, column_id)` — never one query per item.
 *
 * `hasMore` + `nextCursor` are explicit: silent truncation is the failure mode
 * this tool was built to remove, so a partial answer always says it is partial.
 */
export async function listItemsHandler(
  getClient: GetClient,
  input: ListItemsArgs,
): Promise<ToolResult> {
  const limit = input.limit ?? LIST_ITEMS_DEFAULT_LIMIT;
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (input.cursor && !cursor) {
    return toolError(
      "Invalid cursor — pass back the `nextCursor` from a previous list_items response, or omit it to start from the beginning.",
    );
  }

  // Exactly once per handler invocation: each call charges the MCP rate limit
  // and rotates the OAuth bridge secret (`src/lib/mcp/context.ts`).
  const supabase = await getClient();

  let itemsFilter = supabase
    .from("items")
    .select("id, name, group_id, position")
    .eq("board_id", input.boardId)
    .is("archived_at", null);
  if (input.groupId) itemsFilter = itemsFilter.eq("group_id", input.groupId);
  if (cursor) {
    itemsFilter = itemsFilter.or(
      `position.gt.${cursor.position},and(position.eq.${cursor.position},id.gt.${cursor.id})`,
    );
  }
  // Over-fetch by one: the extra row is the honest signal that more exist.
  const itemsQuery = itemsFilter
    .order("position", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1);

  const [boardRes, columnsRes, groupsRes, itemsRes] = await Promise.all([
    supabase
      .from("boards")
      .select("id, name")
      .eq("id", input.boardId)
      .maybeSingle(),
    supabase
      .from("columns")
      .select("id, name, kind")
      .eq("board_id", input.boardId)
      .order("position", { ascending: true }),
    supabase
      .from("groups")
      .select("id, name")
      .eq("board_id", input.boardId)
      .is("archived_at", null)
      .order("position", { ascending: true }),
    itemsQuery,
  ]);

  // RLS, not application code, is what makes another org's board invisible —
  // it simply returns no row, which is the same "not found" the user sees.
  if (boardRes.error || !boardRes.data) return toolError("Board not found.");
  if (itemsRes.error) {
    return toolError(`Failed to fetch items: ${itemsRes.error.message}`);
  }

  const rows = itemsRes.data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const cellsByItem = new Map<string, Record<string, unknown>>();
  if (page.length > 0) {
    const { data: cells, error: cellErr } = await supabase
      .from("cell_values")
      .select("item_id, column_id, value")
      .in(
        "item_id",
        page.map((r) => r.id),
      );
    if (cellErr) {
      return toolError(`Failed to fetch cell values: ${cellErr.message}`);
    }
    for (const cell of cells ?? []) {
      const bucket = cellsByItem.get(cell.item_id) ?? {};
      bucket[cell.column_id] = cell.value;
      cellsByItem.set(cell.item_id, bucket);
    }
  }

  const last = page.at(-1);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          board: boardRes.data,
          // Sent with every page so the response is self-describing: the
          // caller can label `cells` without a second get_board round trip.
          columns: columnsRes.data ?? [],
          groups: groupsRes.data ?? [],
          items: page.map((r) => ({
            id: r.id,
            name: r.name,
            groupId: r.group_id,
            // Keyed by column id, empty cells omitted — a missing cell_values
            // row IS an empty cell, so absence is the accurate encoding.
            cells: cellsByItem.get(r.id) ?? {},
          })),
          hasMore,
          ...(hasMore && last
            ? { nextCursor: encodeCursor(last.position, last.id) }
            : {}),
        }),
      },
    ],
  };
}

export const listItemsDescriptor: ToolDescriptor = {
  name: "list_items",
  title: "List items",
  description:
    `List a board's items together with their cell values, plus the board's columns and groups — ` +
    `everything needed to answer "what's on this board?" in one call. ` +
    `Prefer this over calling get_item repeatedly. ` +
    `Returns up to ${LIST_ITEMS_DEFAULT_LIMIT} items by default (max ${LIST_ITEMS_MAX_LIMIT}); ` +
    `when "hasMore" is true, call again passing "nextCursor" as "cursor" to get the next page. ` +
    `Optionally filter to one group with "groupId".`,
  inputSchema: listItemsInput,
  capability: null,
  scope: "boardId",
  invoke: (ctx, input) =>
    listItemsHandler(ctx.getClient, input as ListItemsArgs),
};
