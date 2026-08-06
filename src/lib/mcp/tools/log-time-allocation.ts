import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { upsertTimeAllocationCore } from "@/lib/time/allocation-core";
import { resolveOrgForTool } from "@/lib/mcp/org-scope";
import type { GetClient, ToolResult } from "./shared";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use `YYYY-MM-DD`.");

/** Max seconds in one cell — 24h. Guards a mis-parsed "2" meaning 2 hours. */
export const MAX_ALLOCATION_SECS = 86_400;

/** Matches `category` in `src/lib/validations/time.ts` — a shorter cap here
 * would make a category created in `/time` unreachable over MCP. */
export const MAX_CATEGORY_LENGTH = 120;

export const logTimeAllocationInput = {
  orgId: z.string().uuid().optional(),
  date: isoDate,
  itemId: z.string().uuid().optional(),
  category: z.string().trim().min(1).max(MAX_CATEGORY_LENGTH).optional(),
  secs: z.number().int().min(0).max(MAX_ALLOCATION_SECS),
  note: z.string().trim().max(500).optional(),
};

type Args = {
  orgId?: string;
  date: string;
  itemId?: string;
  category?: string;
  secs: number;
  note?: string;
};

export async function logTimeAllocationHandler(
  getClient: GetClient,
  actorId: string,
  args: Args,
): Promise<ToolResult> {
  // Exactly one of itemId/category: the choice selects the upsert conflict
  // target (the two unique partial indexes on time_allocations). Checked
  // BEFORE getClient() so a malformed call costs no rate-limit budget.
  const hasItem = !!args.itemId;
  const hasCategory = !!args.category;
  if (hasItem === hasCategory)
    return {
      content: [
        {
          type: "text",
          text: "Provide exactly one of `itemId` or `category`.",
        },
      ],
      isError: true,
    };

  const supabase = await getClient();
  const scope = await resolveOrgForTool(supabase, args.orgId);
  if ("error" in scope)
    return { content: [{ type: "text", text: scope.error }], isError: true };

  const res = await upsertTimeAllocationCore(
    supabase,
    {
      workDate: args.date,
      itemId: args.itemId ?? null,
      category: args.category ?? null,
      durationSecs: args.secs,
      note: args.note ?? null,
    },
    { userId: actorId, orgId: scope.org.id },
  );
  if (!res.ok)
    return { content: [{ type: "text", text: res.error }], isError: true };

  // Echo the RESOLVED org, always. With `orgId` omitted the default is the
  // caller's first org by name; on the item path a wrong guess fails closed via
  // the item_in_org WITH CHECK, but a category row is constrained by nothing —
  // a multi-org user's time would land somewhere arbitrary with no signal.
  // Naming the org in the payload is that signal.
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          date: args.date,
          secs: res.data.durationSecs,
          cleared: args.secs === 0,
          orgId: scope.org.id,
          orgName: scope.org.name,
        }),
      },
    ],
  };
}

export function registerLogTimeAllocationTool(
  server: McpServer,
  getClient: GetClient,
  actorId: string,
): void {
  server.registerTool(
    "log_time_allocation",
    {
      title: "Log time",
      description:
        "Record manually logged time for the connected user on one day. Provide exactly one of `itemId` (get ids from query/search tools) or `category` (free text). This UPSERTS: calling it again for the same day and target replaces the value rather than adding to it; `secs: 0` clears the entry. Writes only the caller's own time. `orgId` is optional and DEFAULTS TO YOUR FIRST ORGANIZATION BY NAME — pass it explicitly if you belong to more than one (list_organizations); the response always echoes the `orgId`/`orgName` the entry was written to.",
      inputSchema: logTimeAllocationInput,
    },
    async (args) => logTimeAllocationHandler(getClient, actorId, args as Args),
  );
}
