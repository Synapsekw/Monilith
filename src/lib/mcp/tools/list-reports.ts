import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listReportsCore, REPORTS_LIMIT } from "@/lib/reports/queries";
import type { GetClient, ToolResult } from "./shared";

export async function listReportsHandler(
  getClient: GetClient,
  args: { boardId: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    const reports = await listReportsCore(supabase, args.boardId);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            reports.map((r) => ({
              id: r.id,
              name: r.name,
              boardId: r.boardId,
              updatedAt: r.updatedAt,
              blockCount: r.config.blocks.length,
            })),
          ),
        },
      ],
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerListReportsTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "list_reports",
    {
      title: "List reports",
      description: `Reports saved against one board, newest first. Returns at most ${REPORTS_LIMIT}. Get board ids from list_boards.`,
      inputSchema: { boardId: z.string().uuid() },
    },
    async (args) => listReportsHandler(getClient, args),
  );
}
