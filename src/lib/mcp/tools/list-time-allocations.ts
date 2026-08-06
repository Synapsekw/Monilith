import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listTimeAllocationsCore,
  TIME_ALLOCATIONS_LIMIT,
  TIME_RANGE_MAX_DAYS,
} from "@/lib/time/queries";
import { validateRange } from "./range";
import type { GetClient, ToolResult } from "./shared";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use `YYYY-MM-DD`.");

export const listTimeAllocationsInput = {
  from: isoDate,
  to: isoDate,
};

export async function listTimeAllocationsHandler(
  getClient: GetClient,
  userId: string,
  args: { from: string; to: string },
): Promise<ToolResult> {
  // Guard BEFORE getClient(): an invalid range should not charge the rate
  // limit or rotate the bridge secret.
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
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerListTimeAllocationsTool(
  server: McpServer,
  getClient: GetClient,
  actorId: string,
): void {
  server.registerTool(
    "list_time_allocations",
    {
      title: "List time allocations",
      description: `The connected user's manually logged time between two dates, as flat rows. Range must be at most ${TIME_RANGE_MAX_DAYS} days; returns at most ${TIME_ALLOCATIONS_LIMIT} rows. Does not include running-timer entries.`,
      inputSchema: listTimeAllocationsInput,
    },
    async (args) => listTimeAllocationsHandler(getClient, actorId, args),
  );
}
