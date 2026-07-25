import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "./shared";

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
      .select("id, name, kind")
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
          columns: columns ?? [],
          groups: groups ?? [],
        }),
      },
    ],
  };
}

export function registerGetBoardTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_board",
    {
      title: "Get board",
      description: "Get a board's metadata, columns, and groups.",
      inputSchema: getBoardInput,
    },
    async (input) => getBoardHandler(getClient, input),
  );
}
