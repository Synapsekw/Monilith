import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listTimeAllocationsCore,
  TIME_RANGE_MAX_DAYS,
} from "@/lib/time/queries";
import { summarizeAllocations, type SummaryGroupBy } from "@/lib/time/summary";
import { validateRange } from "./range";
import type { GetClient, ToolResult } from "./shared";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use `YYYY-MM-DD`.");

export const getTimeSummaryInput = {
  from: isoDate,
  to: isoDate,
  groupBy: z.enum(["item", "category", "day"]),
};

export async function getTimeSummaryHandler(
  getClient: GetClient,
  userId: string,
  args: { from: string; to: string; groupBy: SummaryGroupBy },
): Promise<ToolResult> {
  const rangeError = validateRange(args.from, args.to, TIME_RANGE_MAX_DAYS);
  if (rangeError)
    return { content: [{ type: "text", text: rangeError }], isError: true };

  const supabase = await getClient();
  try {
    const rows = await listTimeAllocationsCore(supabase, {
      userId,
      from: args.from,
      to: args.to,
    });
    const buckets = summarizeAllocations(rows, args.groupBy);
    return { content: [{ type: "text", text: JSON.stringify(buckets) }] };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerGetTimeSummaryTool(
  server: McpServer,
  getClient: GetClient,
  actorId: string,
): void {
  server.registerTool(
    "get_time_summary",
    {
      title: "Get time summary",
      description: `Totals of the connected user's manually logged time between two dates, grouped by item, category or day. Range must be at most ${TIME_RANGE_MAX_DAYS} days.`,
      inputSchema: getTimeSummaryInput,
    },
    async (args) => getTimeSummaryHandler(getClient, actorId, args),
  );
}
