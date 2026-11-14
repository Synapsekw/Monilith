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

  const { data: items, error: itemsErr } = await supabase
    .from("items")
    .select("id, name, board_id")
    .in("id", ids)
    .is("archived_at", null);
  if (itemsErr) return { error: itemsErr.message };
  const boardIds = [...new Set((items ?? []).map((i) => i.board_id))];
  const { data: boards, error: boardsErr } = await supabase
    .from("boards")
    .select("id, name")
    .in("id", boardIds);
  if (boardsErr) return { error: boardsErr.message };
  const boardName = new Map((boards ?? []).map((b) => [b.id, b.name]));
  const byId = new Map(
    (items ?? []).map((i) => [
      i.id,
      {
        id: i.id,
        name: i.name,
        boardId: i.board_id,
        boardName: boardName.get(i.board_id) ?? "Unknown board",
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
    "Get an item's fields and cell values, plus the items it is blocked by and the items it is blocking (at most 20 each). hiddenDependencies counts linked items you cannot see.",
  inputSchema: getItemInput,
  capability: null,
  scope: "itemId",
  invoke: (ctx, input) =>
    getItemHandler(ctx.getClient, input as { itemId: string }),
};
