import * as z from "zod";
import type { GetClient } from "./shared";
import type { ToolDescriptor } from "./descriptor";

const getItemInput = { itemId: z.string().uuid() };

export const DEPENDENCY_LIMIT = 20;
/** Relation links read per direction (this item's own relation cells, and
 *  other items' relation cells that point at it). Both reads are index-backed:
 *  `relation_links_item_column_idx` and `relation_links_linked_idx`. */
export const RELATION_LIMIT = 30;

type DepItem = {
  id: string;
  name: string;
  boardId: string;
  boardName: string;
  status: string | null;
  done: boolean;
};

type Supabase = Awaited<ReturnType<GetClient>>;

/**
 * Live items by id, each with its board's name. item_facts holds live items
 * only (no archived item, board or group) and is read through the caller's
 * RLS, so a linked item that is archived or that the caller cannot see is
 * simply absent: the callers count it as hidden, and "done" means what it
 * means everywhere else.
 */
async function loadLinkedItems(
  supabase: Supabase,
  ids: string[],
): Promise<Map<string, DepItem> | { error: string }> {
  if (ids.length === 0) return new Map();
  const { data: items, error: itemsErr } = await supabase
    .from("item_facts")
    .select("item_id, name, board_id, status_label, is_done")
    .in("item_id", ids);
  if (itemsErr) return { error: itemsErr.message };
  // The view's columns are typed nullable by the generator; a live item always
  // has an id and a board, so a row without either is dropped (and so counted
  // as hidden by the callers).
  const live = (items ?? []).flatMap((i) =>
    i.item_id !== null && i.board_id !== null
      ? [{ ...i, item_id: i.item_id, board_id: i.board_id }]
      : [],
  );
  const boardIds = [...new Set(live.map((i) => i.board_id))];
  const { data: boards, error: boardsErr } = await supabase
    .from("boards")
    .select("id, name")
    .in("id", boardIds);
  if (boardsErr) return { error: boardsErr.message };
  const boardName = new Map((boards ?? []).map((b) => [b.id, b.name]));
  return new Map(
    live.map((i) => [
      i.item_id,
      {
        id: i.item_id,
        name: i.name ?? "",
        boardId: i.board_id,
        boardName: boardName.get(i.board_id) ?? "Unknown board",
        status: i.status_label,
        done: i.is_done ?? false,
      },
    ]),
  );
}

type Links = {
  blockedBy: DepItem[];
  blocking: DepItem[];
  hiddenDependencies: number;
  relations: { columnId: string; columnName: string; items: DepItem[] }[];
  linkedFrom: DepItem[];
  hiddenRelations: number;
};

/** Dependencies and relation links of one item, both directions, bounded. */
async function loadLinks(
  supabase: Supabase,
  itemId: string,
): Promise<Links | { error: string }> {
  const [pred, succ, out, back] = await Promise.all([
    supabase
      .from("item_dependencies")
      .select("predecessor_id")
      .eq("successor_id", itemId)
      .limit(DEPENDENCY_LIMIT),
    supabase
      .from("item_dependencies")
      .select("successor_id")
      .eq("predecessor_id", itemId)
      .limit(DEPENDENCY_LIMIT),
    // This item's own relation cells, in cell order.
    supabase
      .from("relation_links")
      .select("column_id, linked_item_id, position")
      .eq("item_id", itemId)
      .order("position", { ascending: true })
      .limit(RELATION_LIMIT),
    // Relation cells on other items (any board the caller can read) that
    // point at this one.
    supabase
      .from("relation_links")
      .select("item_id")
      .eq("linked_item_id", itemId)
      .order("created_at", { ascending: false })
      .limit(RELATION_LIMIT),
  ]);
  // A failed read must never look like "nothing blocks this item" or
  // "nothing is linked".
  if (pred.error) return { error: pred.error.message };
  if (succ.error) return { error: succ.error.message };
  if (out.error) return { error: out.error.message };
  if (back.error) return { error: back.error.message };
  const predIds = (pred.data ?? []).map((r) => r.predecessor_id);
  const succIds = (succ.data ?? []).map((r) => r.successor_id);
  const outRows = out.data ?? [];
  const backIds = [...new Set((back.data ?? []).map((r) => r.item_id))];
  const depIds = [...new Set([...predIds, ...succIds])];
  const relIds = [
    ...new Set([...outRows.map((r) => r.linked_item_id), ...backIds]),
  ];

  const byId = await loadLinkedItems(supabase, [
    ...new Set([...depIds, ...relIds]),
  ]);
  if ("error" in byId) return byId;

  const columnIds = [...new Set(outRows.map((r) => r.column_id))];
  const columnName = new Map<string, string>();
  if (columnIds.length > 0) {
    const { data: columns, error: columnsErr } = await supabase
      .from("columns")
      .select("id, name")
      .in("id", columnIds);
    if (columnsErr) return { error: columnsErr.message };
    for (const c of columns ?? []) columnName.set(c.id, c.name);
  }

  const pick = (list: string[]) =>
    list.map((id) => byId.get(id)).filter((d): d is DepItem => Boolean(d));
  return {
    blockedBy: pick(predIds),
    blocking: pick(succIds),
    hiddenDependencies: depIds.filter((id) => !byId.has(id)).length,
    relations: columnIds.map((columnId) => ({
      columnId,
      columnName: columnName.get(columnId) ?? "Unknown column",
      items: pick(
        outRows
          .filter((r) => r.column_id === columnId)
          .map((r) => r.linked_item_id),
      ),
    })),
    linkedFrom: pick(backIds),
    hiddenRelations: relIds.filter((id) => !byId.has(id)).length,
  };
}

export async function getItemHandler(
  getClient: GetClient,
  input: { itemId: string },
) {
  const supabase = await getClient();
  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("id, name, group_id, board_id, position")
    .eq("id", input.itemId)
    .maybeSingle();
  if (itemErr || !item) {
    return {
      content: [{ type: "text" as const, text: "Item not found." }],
      isError: true,
    };
  }
  const { data: cells, error: cellErr } = await supabase
    .from("cell_values")
    .select("column_id, value")
    .eq("item_id", input.itemId);
  if (cellErr) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to fetch cell values: ${cellErr.message}`,
        },
      ],
      isError: true,
    };
  }
  const cellValues = (cells ?? []).map((c) => ({
    columnId: c.column_id,
    value: c.value,
  }));
  const links = await loadLinks(supabase, input.itemId);
  if ("error" in links) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to fetch linked items: ${links.error}`,
        },
      ],
      isError: true,
    };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ item, cellValues, ...links }),
      },
    ],
  };
}

export const getItemDescriptor: ToolDescriptor = {
  name: "get_item",
  title: "Get item",
  description: `Get an item's fields and cell values, plus the items it is blocked by and the items it is blocking (at most ${DEPENDENCY_LIMIT} each, each with its status and whether it is done). hiddenDependencies counts linked items you cannot see. Also its relation links: \`relations\` lists, per relation column, the items on other boards this item links to, and \`linkedFrom\` the items whose relation columns link to this one (at most ${RELATION_LIMIT} links each way); hiddenRelations counts linked items you cannot see. Relation links are read-only here.`,
  inputSchema: getItemInput,
  capability: null,
  scope: "itemId",
  invoke: (ctx, input) =>
    getItemHandler(ctx.getClient, input as { itemId: string }),
};
