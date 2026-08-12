import { z } from "zod";
import type { GetClient } from "./shared";
import { describeColumn } from "./column-meta";
import type { ToolDescriptor } from "./descriptor";

const getBoardInput = { boardId: z.string().uuid() };

export async function getBoardHandler(
  getClient: GetClient,
  input: { boardId: string },
) {
  const supabase = await getClient();
  const { data: board, error: boardErr } = await supabase
    .from("boards")
    .select("id, name, description")
    .eq("id", input.boardId)
    .maybeSingle();
  if (boardErr || !board) {
    return {
      content: [{ type: "text" as const, text: "Board not found." }],
      isError: true,
    };
  }
  const [{ data: columns }, { data: groups }] = await Promise.all([
    supabase
      .from("columns")
      .select("id, name, kind, settings")
      .eq("board_id", input.boardId)
      .order("position", { ascending: true }),
    supabase
      .from("groups")
      .select("id, name")
      .eq("board_id", input.boardId)
      .is("archived_at", null)
      .order("position", { ascending: true }),
  ]);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          board,
          columns: (columns ?? []).map(describeColumn),
          groups: groups ?? [],
        }),
      },
    ],
  };
}

export const getBoardDescriptor: ToolDescriptor = {
  name: "get_board",
  title: "Get board",
  description:
    "Get a board's metadata, columns, and groups. Each column reports " +
    "`writable`, a `valueShape` string for create_item/update_item field " +
    "values, `options` (status/dropdown: use an option's `id` as `optionId`), " +
    "and any settings that affect writes. Columns with `writable: false` " +
    "cannot be set via `fields` — use `attach_file` for `files` columns.",
  inputSchema: getBoardInput,
  capability: null,
  scope: "boardId",
  invoke: (ctx, input) =>
    getBoardHandler(ctx.getClient, input as { boardId: string }),
};
