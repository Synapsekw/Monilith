import { z } from "zod";
import {
  listTimeAllocationsCore,
  TIME_ALLOCATIONS_LIMIT,
  TIME_RANGE_MAX_DAYS,
} from "@/lib/time/queries";
import { summarizeAllocations, type SummaryGroupBy } from "@/lib/time/summary";
import { validateRange } from "./range";
import type { GetClient, ToolResult } from "./shared";
import type { ToolDescriptor } from "./descriptor";

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
    const result = await listTimeAllocationsCore(supabase, {
      userId,
      from: args.from,
      to: args.to,
    });
    // A partial sum presented as a total is worse than an error: if the
    // window holds more rows than the cap, refuse rather than silently
    // summing only the first TIME_ALLOCATIONS_LIMIT rows.
    if (result.truncated) {
      return {
        content: [
          {
            type: "text",
            text: `Row cap exceeded: this window has more than ${TIME_ALLOCATIONS_LIMIT} time allocations, so the summary would be a partial total, not a complete one. Narrow the window and call again.`,
          },
        ],
        isError: true,
      };
    }
    // `{ buckets, ungroupedSecs }`, not a bare bucket array: an allocation
    // carries EITHER an item OR a category, so grouping by one silently drops
    // every row logged under the other. Returning the dropped seconds is the
    // same refusal-to-be-confidently-partial as the row-cap guard above.
    const summary = summarizeAllocations(result.rows, args.groupBy);
    return { content: [{ type: "text", text: JSON.stringify(summary) }] };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export const getTimeSummaryDescriptor: ToolDescriptor = {
  name: "get_time_summary",
  title: "Get time summary",
  description: `Totals of the connected user's manually logged time between two dates, grouped by item, category or day. Returns \`{ buckets, ungroupedSecs }\`. Time is logged against EITHER an item OR a category, so grouping by one excludes the other: \`ungroupedSecs\` is the excluded seconds (always 0 for \`day\`) — if it is above 0, say so rather than reporting the buckets as the whole total. Range must be at most ${TIME_RANGE_MAX_DAYS} days and the window's rows at most ${TIME_ALLOCATIONS_LIMIT} — if exceeded, returns an error instead of a partial total, so narrow the window.`,
  inputSchema: getTimeSummaryInput,
  capability: null,
  scope: "none",
  invoke: (ctx, input) =>
    getTimeSummaryHandler(
      ctx.getClient,
      ctx.actorId,
      input as { from: string; to: string; groupBy: SummaryGroupBy },
    ),
};
