import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listPortfoliosCore, PORTFOLIO_LIMIT } from "@/lib/portfolios/queries";
import type { GetClient, ToolResult } from "./shared";

export async function listPortfoliosHandler(
  getClient: GetClient,
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    const portfolios = await listPortfoliosCore(supabase);
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
      description: `Portfolios visible to the connected user, with how many boards each contains. Returns at most ${PORTFOLIO_LIMIT}.`,
      inputSchema: {},
    },
    async () => listPortfoliosHandler(getClient),
  );
}
