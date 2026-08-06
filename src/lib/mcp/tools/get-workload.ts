import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getWorkloadSummaryCore } from "@/lib/workload/queries";
import { resolveOrgForTool, listOrgMemberProfiles } from "@/lib/mcp/org-scope";
import { validateRange } from "./range";
import type { GetClient, ToolResult } from "./shared";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use `YYYY-MM-DD`.");

/** A quarter is the longest window a capacity comparison stays meaningful over. */
export const WORKLOAD_RANGE_MAX_DAYS = 92;
const DAY_MS = 86_400_000;

function defaultWindow(): { from: string; to: string } {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(now), to: iso(now + 27 * DAY_MS) };
}

export async function getWorkloadHandler(
  getClient: GetClient,
  args: { orgId?: string; from?: string; to?: string },
): Promise<ToolResult> {
  const window =
    args.from && args.to ? { from: args.from, to: args.to } : defaultWindow();

  // Guard BEFORE getClient(): an invalid range should not charge the rate
  // limit or rotate the bridge secret.
  const rangeError = validateRange(
    window.from,
    window.to,
    WORKLOAD_RANGE_MAX_DAYS,
  );
  if (rangeError)
    return { content: [{ type: "text", text: rangeError }], isError: true };

  const supabase = await getClient();
  const scope = await resolveOrgForTool(supabase, args.orgId);
  if ("error" in scope)
    return { content: [{ type: "text", text: scope.error }], isError: true };

  try {
    const members = await listOrgMemberProfiles(supabase, scope.org.id);
    const rows = await getWorkloadSummaryCore(supabase, {
      orgId: scope.org.id,
      from: window.from,
      to: window.to,
      members,
    });
    return {
      content: [
        { type: "text", text: JSON.stringify({ ...window, members: rows }) },
      ],
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerGetWorkloadTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_workload",
    {
      title: "Get workload",
      description: `Planned load per team member over a date window: allocated seconds from item estimates, item count, and capacity seconds. Defaults to the next four weeks. Range must be at most ${WORKLOAD_RANGE_MAX_DAYS} days. Pass both \`from\` and \`to\` together, or neither.`,
      inputSchema: {
        orgId: z.string().uuid().optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
      },
    },
    async (args) => getWorkloadHandler(getClient, args),
  );
}
