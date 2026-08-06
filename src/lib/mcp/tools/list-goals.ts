import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getGoalsTreeCore, GOALS_LIMIT } from "@/lib/goals/queries";
import { resolveOrgForTool, listOrgMemberProfiles } from "@/lib/mcp/org-scope";
import type { GoalNode, RowOwner } from "@/lib/goals/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { GetClient, ToolResult } from "./shared";

export type FlatGoal = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  percent: number | null;
  status: string;
  ownerName: string | null;
  dueDate: string | null;
};

/** Depth-first flatten. A tree is hard for a model to scan; `depth` preserves
 *  the hierarchy without the nesting. */
export function flattenGoals(nodes: GoalNode[], depth = 0): FlatGoal[] {
  const out: FlatGoal[] = [];
  for (const n of nodes) {
    out.push({
      id: n.id,
      name: n.name,
      parentId: n.parentGoalId,
      depth,
      percent: n.percent,
      status: n.status,
      ownerName: n.owner?.fullName ?? null,
      dueDate: n.dueDate,
    });
    out.push(...flattenGoals(n.children, depth + 1));
  }
  return out;
}

/** Shared by list_goals and get_goal: resolve org, build the owner map over the
 *  BRIDGED client, then assemble the tree. */
export async function loadGoalTree(
  supabase: SupabaseClient<Database>,
  requestedOrgId?: string,
): Promise<{ nodes: GoalNode[] } | { error: string }> {
  const scope = await resolveOrgForTool(supabase, requestedOrgId);
  if ("error" in scope) return { error: scope.error };

  const members = await listOrgMemberProfiles(supabase, scope.org.id);
  const owners = new Map<string, RowOwner>(
    members.map((m) => [
      m.userId,
      {
        userId: m.userId,
        fullName: m.fullName,
        // `listOrgMemberProfiles` reads the bridged client and never selects
        // email (spec §3.2 — no service client on the MCP path, and no tool
        // surface needs it). `RowOwner` requires the field for the RSC path's
        // shape; MCP always supplies null here.
        email: null,
        avatarUrl: m.avatarUrl,
      },
    ]),
  );
  return {
    // `orgId` is passed, not merely validated: `goals` RLS is org-membership,
    // so without it a two-org caller who asked about org A also gets org B's
    // goals — reported as A's, and with `ownerName: null` because `owners`
    // only holds A's members.
    nodes: await getGoalsTreeCore(supabase, {
      owners,
      nowMs: Date.now(),
      orgId: scope.org.id,
    }),
  };
}

export async function listGoalsHandler(
  getClient: GetClient,
  args: { orgId?: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  const res = await loadGoalTree(supabase, args.orgId);
  if ("error" in res)
    return { content: [{ type: "text", text: res.error }], isError: true };
  return {
    content: [{ type: "text", text: JSON.stringify(flattenGoals(res.nodes)) }],
  };
}

export function registerListGoalsTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "list_goals",
    {
      title: "List goals",
      description: `Every goal visible to the connected user, flattened depth-first with a \`depth\` field preserving the hierarchy. Returns at most ${GOALS_LIMIT} goals.`,
      inputSchema: { orgId: z.string().uuid().optional() },
    },
    async (args) => listGoalsHandler(getClient, args),
  );
}
