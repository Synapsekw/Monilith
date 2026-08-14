import { z } from "zod";
import {
  listTimeAllocationsCore,
  TIME_ALLOCATIONS_LIMIT,
  TIME_RANGE_MAX_DAYS,
} from "@/lib/time/queries";
import { validateRange } from "./range";
import type { GetClient, ToolResult } from "./shared";
import type { ToolDescriptor } from "./descriptor";

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
    const result = await listTimeAllocationsCore(supabase, {
      userId,
      from: args.from,
      to: args.to,
    });
    // A list is understood to be capped — surface `truncated` in the payload
    // rather than erroring, so the agent knows more rows exist beyond the cap.
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            rows: result.rows,
            truncated: result.truncated,
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

export const listTimeAllocationsDescriptor: ToolDescriptor = {
  name: "list_time_allocations",
  title: "List time allocations",
  description: `The connected user's manually logged time between two dates, as flat rows. Range must be at most ${TIME_RANGE_MAX_DAYS} days; returns at most ${TIME_ALLOCATIONS_LIMIT} rows, with \`truncated: true\` in the payload if more exist — narrow the window to see them. Does not include running-timer entries.`,
  inputSchema: listTimeAllocationsInput,
  capability: null,
  scope: "none",
  invoke: (ctx, input) =>
    listTimeAllocationsHandler(
      ctx.getClient,
      ctx.actorId,
      input as { from: string; to: string },
    ),
};
