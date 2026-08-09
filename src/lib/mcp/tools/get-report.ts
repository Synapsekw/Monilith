import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getReportCore,
  resolveReportBoardIdsCore,
} from "@/lib/reports/queries";
import { readableBoardIds } from "./board-access";
import type { GetClient, ToolResult } from "./shared";

export async function getReportHandler(
  getClient: GetClient,
  args: { reportId: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  // ONE string for every refusal. A report that does not exist, one whose
  // boards are all private to the caller, and one in another org must be
  // byte-identical answers — the refusal itself must never disclose existence.
  const notFound: ToolResult = {
    content: [{ type: "text", text: `Report ${args.reportId} not found.` }],
    isError: true,
  };
  try {
    const report = await getReportCore(supabase, args.reportId);
    if (!report) return notFound;

    // `reports` RLS is only `is_org_member(org_id)`; the boards a report is
    // built over are narrower (creator-or-board-member). Without this precheck
    // an org member who cannot open a private board could still read its
    // report's name, timestamp, and every block's type and chart title.
    //
    // A report now spans MANY boards (`report_boards` is the canonical
    // membership; `resolveReportBoardIdsCore` is the one place it is resolved,
    // including the portfolio scope's auto-follow). The rule:
    //
    //   readable  ⟺  at least ONE bound board is readable
    //                OR the report is a template (config only, no board data —
    //                the org gallery, readable by any org member).
    //
    // Templates short-circuit to zero bound boards rather than resolving: a
    // template carries no board data by construction, so it must never carry
    // board ids out to a caller who was never board-gated for them.
    const boardIds =
      report.scope === "template"
        ? []
        : await resolveReportBoardIdsCore(supabase, report);
    if (report.scope !== "template") {
      // One set-based probe for the whole membership — never one per board.
      const readable = await readableBoardIds(supabase, boardIds);
      if (readable.size === 0) return notFound;
    }

    // Structure only. Resolving a report's numbers needs each board's full
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
            scope: report.scope,
            // Kept (now nullable) so clients connected before multi-board
            // reports do not hard-break: for scope "board" it is still the
            // board; for a roll-up or template it is null and `boardIds` is
            // the real answer.
            boardId: report.boardId,
            boardIds,
            // Only a portfolio roll-up has one; omitted elsewhere rather than
            // emitted as a null the caller has to special-case.
            ...(report.scope === "portfolio"
              ? { portfolioId: report.portfolioId }
              : {}),
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
        "One report's structure — its name, scope, the board(s) it is bound to, and the ordered blocks it is built from. A report can span one board, many boards, a whole portfolio, or none at all (a template). Does not resolve the blocks' data; use list_items or get_widget_data for numbers. Get ids from list_reports.",
      inputSchema: { reportId: z.string().uuid() },
    },
    async (args) => getReportHandler(getClient, args),
  );
}
