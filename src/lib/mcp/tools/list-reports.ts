import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listReportsForBoardCore,
  resolveReportBoardIdsCore,
  REPORTS_LIMIT,
  type ReportRow,
} from "@/lib/reports/queries";
import type { Database } from "@/types/database.types";
import { canReadBoard } from "./board-access";
import type { GetClient, ToolResult } from "./shared";

/**
 * How many boards a report spans — with no membership read at all in the
 * common case.
 *
 * `scope` already answers it for the two shapes that dominate a board's
 * listing, and the schema guarantees it: `reports_scope_binding_ck` pins
 * scope "board" to exactly one non-null `board_id` (backfilled 1:1 into
 * `report_boards`), and a template has no boards by construction. Only a
 * genuine roll-up ("boards" / "portfolio") needs `resolveReportBoardIdsCore`,
 * the one place membership is resolved — an indexed `report_boards.report_id`
 * (or portfolio) lookup, and only for the handful of roll-ups that cover the
 * queried board.
 */
async function reportBoardCount(
  supabase: SupabaseClient<Database>,
  report: ReportRow,
): Promise<number> {
  if (report.scope === "template") return 0;
  if (report.scope === "board") return 1;
  return (await resolveReportBoardIdsCore(supabase, report)).length;
}

export async function listReportsHandler(
  getClient: GetClient,
  args: { boardId: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    // `reports` RLS is only `is_org_member(org_id)`, so listing by board id
    // would hand an org member the name and id of every report on a private
    // board they cannot open. Gate on the board FIRST — before any report read
    // happens at all — using the same "Board not found." wording list_items
    // uses, so an unreadable board is indistinguishable from a nonexistent one.
    //
    // One board in, one board gated: everything returned below is a report
    // that renders THIS board, so this single probe is the whole authorization
    // question. (A roll-up surfaced here may also cover boards the caller
    // cannot open — get_report re-gates on its own membership.)
    if (!(await canReadBoard(supabase, args.boardId)))
      return {
        content: [{ type: "text", text: "Board not found." }],
        isError: true,
      };

    // Membership lives in `report_boards` now, so a multi-board or portfolio
    // roll-up that includes this board shows up here too — not just reports
    // whose home board it is. Templates are excluded (they render no board).
    const reports = await listReportsForBoardCore(supabase, args.boardId);
    const boardCounts = await Promise.all(
      reports.map((r) => reportBoardCount(supabase, r)),
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            reports.map((r, i) => ({
              id: r.id,
              name: r.name,
              scope: r.scope,
              // Nullable since v2 — the *home* board, null for a roll-up.
              // Kept so clients connected before multi-board reports do not
              // hard-break; `boardCount` is the real span.
              boardId: r.boardId,
              boardCount: boardCounts[i],
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
      description: `Reports that include this board, newest first — the ones bound to it alone plus any multi-board or portfolio roll-up that covers it. Each entry says how many boards it spans; templates are not listed. Returns at most ${REPORTS_LIMIT}. Get board ids from list_boards.`,
      inputSchema: { boardId: z.string().uuid() },
    },
    async (args) => listReportsHandler(getClient, args),
  );
}
