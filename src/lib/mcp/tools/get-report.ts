import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getReportCore } from "@/lib/reports/queries";
import type { GetClient, ToolResult } from "./shared";

export async function getReportHandler(
  getClient: GetClient,
  args: { reportId: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    const report = await getReportCore(supabase, args.reportId);
    if (!report)
      return {
        content: [{ type: "text", text: `Report ${args.reportId} not found.` }],
        isError: true,
      };

    // Structure only. Resolving a report's numbers needs the board's full
    // payload (every cell value, attachment, time entry) — an unbounded read
    // this tool must not perform. Deferred to Spec 2.
    //
    // Only the `chart` block variant carries an explicit `options.title`
    // (config.ts) — every other block type has no title field at all, and an
    // unset chart title is "" (meaning "derive at render time"), which we
    // fold to `null` here so the caller sees one consistent "no title" value.
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            id: report.id,
            name: report.name,
            boardId: report.boardId,
            updatedAt: report.updatedAt,
            blocks: report.config.blocks.map((b) => ({
              type: b.type,
              title: "title" in b.options ? b.options.title || null : null,
            })),
          }),
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

export function registerGetReportTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_report",
    {
      title: "Get report",
      description:
        "One report's structure — its name, board, and the ordered blocks it is built from. Does not resolve the blocks' data; use list_items or get_widget_data for numbers. Get ids from list_reports.",
      inputSchema: { reportId: z.string().uuid() },
    },
    async (args) => getReportHandler(getClient, args),
  );
}
