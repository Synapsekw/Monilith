import * as z from "zod";
import type { GetClient } from "./shared";
import type { ToolDescriptor } from "./descriptor";

const getItemInput = { itemId: z.string().uuid() };

export const DEPENDENCY_LIMIT = 20;

type DepItem = {
  id: string;
  name: string;
  boardId: string;
  boardName: string;
  status: string | null;
  done: boolean;
};

async function loadDependencies(
  supabase: Awaited<ReturnType<GetClient>>,
  itemId: string,
): Promise<
  | {
      blockedBy: DepItem[];
      blocking: DepItem[];
      hiddenDependencies: number;
    }
  | { error: string }
> {
  const [pred, succ] = await Promise.all([
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
  ]);
  // A failed read must never look like "nothing blocks this item".
  if (pred.error) return { error: pred.error.message };
  if (succ.error) return { error: succ.error.message };
  const predIds = (pred.data ?? []).map((r) => r.predecessor_id);
  const succIds = (succ.data ?? []).map((r) => r.successor_id);
  const ids = [...new Set([...predIds, ...succIds])];
  if (ids.length === 0)
    return { blockedBy: [], blocking: [], hiddenDependencies: 0 };

  // item_facts holds live items only (no archived item, board or group), so a
  // link to one of those is counted as hidden below, and "done" means what it
  // means everywhere else.
  const { data: items, error: itemsErr } = await supabase
    .from("item_facts")
    .select("item_id, name, board_id, status_label, is_done")
    .in("item_id", ids);
  if (itemsErr) return { error: itemsErr.message };
  // The view's columns are typed nullable by the generator; a live item always
  // has an id and a board, so a row without either is dropped (and so counted
  // as hidden below).
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
  const byId = new Map(
    live.map((i) => [
      i.item_id,
      {
        id: i.item_id,
        name: i.name,
        boardId: i.board_id,
        boardName: boardName.get(i.board_id) ?? "Unknown board",
        status: i.status_label,
        done: i.is_done,
      },
    ]),
  );
  const pick = (list: string[]) =>
    list.map((id) => byId.get(id)).filter((d): d is DepItem => Boolean(d));
  return {
    blockedBy: pick(predIds),
    blocking: pick(succIds),
    hiddenDependencies: ids.length - byId.size,
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
  const deps = await loadDependencies(supabase, input.itemId);
  if ("error" in deps) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to fetch dependencies: ${deps.error}`,
        },
      ],
      isError: true,
    };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ item, cellValues, ...deps }),
      },
    ],
  };
}

export const getItemDescriptor: ToolDescriptor = {
  name: "get_item",
  title: "Get item",
  description:
    "Get an item's fields and cell values, plus the items it is blocked by and the items it is blocking (at most 20 each, each with its status and whether it is done). hiddenDependencies counts linked items you cannot see.",
  inputSchema: getItemInput,
  capability: null,
  scope: "itemId",
  invoke: (ctx, input) =>
    getItemHandler(ctx.getClient, input as { itemId: string }),
};
