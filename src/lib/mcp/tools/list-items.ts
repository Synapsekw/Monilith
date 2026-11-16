import * as z from "zod";
import type { GetClient, ToolResult } from "./shared";
import type { ToolDescriptor } from "./descriptor";
import { fetchCappedRows } from "@/lib/supabase/paginate";

/** Page size when the caller does not ask for one. Most boards fit in one page. */
export const LIST_ITEMS_DEFAULT_LIMIT = 100;
/** Hard ceiling — working agreement #5: a hot-path read is never unbounded. */
export const LIST_ITEMS_MAX_LIMIT = 200;

/**
 * Most cell values one call returns: a full page ({@link LIST_ITEMS_MAX_LIMIT}
 * items) of a 100-column board. The cell read pages through PostgREST's
 * 1,000-row responses up to this bound, so an ordinary page always comes back
 * complete; it used to stop at the first response, which cut the default page
 * on any board wider than 10 filled columns without saying so. A read that
 * still exceeds this is reported (`truncated`), never silent.
 */
export const LIST_ITEMS_CELLS_CAP = LIST_ITEMS_MAX_LIMIT * 100;

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
  /** Items whose cell values are not all in this response. */
  const incomplete = new Set<string>();
  if (page.length > 0) {
    // Ordered by the `(item_id, column_id)` PRIMARY KEY so a cut is
    // deterministic, and read one row past the cap so a cut is known: without
    // it, items past the cap came back with empty `cells` that looked real.
    const {
      data: cells,
      error: cellErr,
      truncated,
    } = await fetchCappedRows(
      (from, to) =>
        supabase
          .from("cell_values")
          .select("item_id, column_id, value")
          .in(
            "item_id",
            page.map((r) => r.id),
          )
          .order("item_id", { ascending: true })
          .order("column_id", { ascending: true })
          .range(from, to),
      // A typical wide page is 2 to 3 responses; a small wave keeps the
      // follow-up requests from fanning out past what the page can hold.
      { cap: LIST_ITEMS_CELLS_CAP, wave: 3 },
    );
    if (cellErr) {
      return toolError(`Failed to fetch cell values: ${cellErr.message}`);
    }
    const lastLoaded = truncated ? cells?.at(-1)?.item_id : undefined;
    if (lastLoaded !== undefined) {
      // Rows arrive in item_id order, so every item sorting before the last
      // loaded row is complete. That last item may be cut mid-way and every
      // later one has nothing loaded: all of those are reported, never guessed.
      for (const r of page) if (r.id >= lastLoaded) incomplete.add(r.id);
    }
    for (const cell of cells ?? []) {
      const bucket = cellsByItem.get(cell.item_id) ?? {};
      bucket[cell.column_id] = cell.value;
      cellsByItem.set(cell.item_id, bucket);
    }
  }

  const last = page.at(-1);
  const columnCount = (columnsRes.data ?? []).length;
  // An item holds at most one cell per column, so this many items always fit
  // under the cap. With no column list to go on, fall back to what did fit.
  const safeLimit = Math.max(
    1,
    columnCount > 0
      ? Math.floor(LIST_ITEMS_CELLS_CAP / columnCount)
      : page.length - incomplete.size,
  );
  const cellsCut = incomplete.size > 0;
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
            ...(incomplete.has(r.id) ? { cellsTruncated: true } : {}),
          })),
          hasMore,
          ...(hasMore && last
            ? { nextCursor: encodeCursor(last.position, last.id) }
            : {}),
          // Always present, so a client can tell "complete" from "not told".
          truncated: cellsCut,
          ...(cellsCut
            ? {
                next: {
                  tool: "list_items",
                  args: {
                    boardId: input.boardId,
                    ...(input.groupId ? { groupId: input.groupId } : {}),
                    ...(input.cursor ? { cursor: input.cursor } : {}),
                    limit: safeLimit,
                  },
                  incompleteItemIds: [...incomplete],
                  hint:
                    `Cell values stop at ${LIST_ITEMS_CELLS_CAP} per call, so ${incomplete.size} of the ${page.length} items here ` +
                    `(marked "cellsTruncated") have missing or partial "cells" — do not read them as empty. ` +
                    `Call list_items again with the same cursor and "limit" ${safeLimit} or lower to get every item complete, ` +
                    `narrow with "groupId", or call get_item for a single item.`,
                },
              }
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
    `Optionally filter to one group with "groupId". ` +
    `One call carries at most ${LIST_ITEMS_CELLS_CAP} cell values: on an extremely wide board, when "truncated" is true, ` +
    `the items marked "cellsTruncated" are incomplete and "next" gives the arguments (a smaller "limit") that return them in full.`,
  inputSchema: listItemsInput,
  capability: null,
  scope: "boardId",
  invoke: (ctx, input) =>
    listItemsHandler(ctx.getClient, input as ListItemsArgs),
};
