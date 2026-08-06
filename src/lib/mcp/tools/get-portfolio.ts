import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPortfolioRowsCore } from "@/lib/portfolios/queries";
import { serverToday } from "@/lib/portfolios/rollup";
import { listOrgMemberProfiles } from "@/lib/mcp/org-scope";
import type { RowOwner } from "@/lib/portfolios/types";
import type { GetClient, ToolResult } from "./shared";

export async function getPortfolioHandler(
  getClient: GetClient,
  args: { portfolioId: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    const todayIso = serverToday(Date.now());

    // Cheap indexed head read FIRST, purely to learn the org — the rollup RPC
    // must run exactly once. (An earlier draft called the core twice, once with
    // an empty owner map; that doubled the rollup for nothing.) The org id comes
    // off a row read through the BRIDGED client, which is what makes the
    // subsequent member read entitled.
    const { data: head, error: headErr } = await supabase
      .from("portfolios")
      .select("id, org_id")
      .eq("id", args.portfolioId)
      .maybeSingle();
    if (headErr)
      throw new Error(`Failed to load portfolio: ${headErr.message}`);
    if (!head)
      return {
        content: [
          { type: "text", text: `Portfolio ${args.portfolioId} not found.` },
        ],
        isError: true,
      };

    const members = await listOrgMemberProfiles(supabase, head.org_id);
    const owners = new Map<string, RowOwner>(
      members.map((m) => [
        m.userId,
        { userId: m.userId, fullName: m.fullName, avatarUrl: m.avatarUrl },
      ]),
    );
    const result = await getPortfolioRowsCore(supabase, args.portfolioId, {
      owners,
      todayIso,
    });
    if (!result)
      return {
        content: [
          { type: "text", text: `Portfolio ${args.portfolioId} not found.` },
        ],
        isError: true,
      };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            id: result.portfolio.id,
            name: result.portfolio.name,
            boards: result.rows.map((r) => ({
              boardId: r.boardId,
              boardName: r.name,
              totalItems: r.totalItems,
              doneItems: r.doneItems,
              overdueItems: r.overdueItems,
              health: r.health,
              ownerName: r.owner?.fullName ?? null,
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

export function registerGetPortfolioTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_portfolio",
    {
      title: "Get portfolio",
      description:
        "One portfolio's board rollup — item totals, done counts, overdue counts, health and owner per board. Get ids from list_portfolios.",
      inputSchema: { portfolioId: z.string().uuid() },
    },
    async (args) => getPortfolioHandler(getClient, args),
  );
}
