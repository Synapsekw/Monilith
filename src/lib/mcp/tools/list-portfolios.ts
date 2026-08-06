import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listPortfoliosCore, PORTFOLIO_LIMIT } from "@/lib/portfolios/queries";
import { resolveOrgForTool } from "@/lib/mcp/org-scope";
import type { GetClient, ToolResult } from "./shared";

export async function listPortfoliosHandler(
  getClient: GetClient,
  args: { orgId?: string } = {},
): Promise<ToolResult> {
  const supabase = await getClient();
  const scope = await resolveOrgForTool(supabase, args.orgId);
  if ("error" in scope)
    return { content: [{ type: "text", text: scope.error }], isError: true };

  try {
    // The resolved org is passed DOWN, not just validated — see
    // listPortfoliosCore. Every other org-scoped tool resolves the same way.
    const portfolios = await listPortfoliosCore(supabase, {
      orgId: scope.org.id,
    });
    if (portfolios.length === 0)
      return { content: [{ type: "text", text: "[]" }] };

    // ONE grouped read for the counts — never one query per portfolio.
    const { data, error } = await supabase
      .from("portfolio_boards")
      .select("portfolio_id")
      .in(
        "portfolio_id",
        portfolios.map((p) => p.id),
      );
    if (error)
      throw new Error(`Failed to load portfolio boards: ${error.message}`);

    const counts = new Map<string, number>();
    for (const r of data ?? [])
      counts.set(r.portfolio_id, (counts.get(r.portfolio_id) ?? 0) + 1);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            portfolios.map((p) => ({
              ...p,
              boardCount: counts.get(p.id) ?? 0,
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

export function registerListPortfoliosTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "list_portfolios",
    {
      title: "List portfolios",
      description: `Portfolios visible to the connected user in one organization, with how many boards each contains. Returns at most ${PORTFOLIO_LIMIT}.`,
      inputSchema: { orgId: z.string().uuid().optional() },
    },
    async (args) => listPortfoliosHandler(getClient, args),
  );
}
