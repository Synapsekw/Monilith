import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadGoalTree } from "./list-goals";
import type { GoalNode } from "@/lib/goals/types";
import type { GetClient, ToolResult } from "./shared";

function findGoal(nodes: GoalNode[], goalId: string): GoalNode | null {
  for (const n of nodes) {
    if (n.id === goalId) return n;
    const hit = findGoal(n.children, goalId);
    if (hit) return hit;
  }
  return null;
}

export async function getGoalHandler(
  getClient: GetClient,
  args: { goalId: string; orgId?: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  const res = await loadGoalTree(supabase, args.orgId);
  if ("error" in res)
    return { content: [{ type: "text", text: res.error }], isError: true };

  const goal = findGoal(res.nodes, args.goalId);
  if (!goal)
    return {
      content: [{ type: "text", text: `Goal ${args.goalId} not found.` }],
      isError: true,
    };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          id: goal.id,
          name: goal.name,
          description: goal.description,
          parentId: goal.parentGoalId,
          status: goal.status,
          percent: goal.percent,
          progressMode: goal.progressMode,
          startValue: goal.startValue,
          currentValue: goal.currentValue,
          targetValue: goal.targetValue,
          unit: goal.unit,
          startDate: goal.startDate,
          dueDate: goal.dueDate,
          ownerName: goal.owner?.fullName ?? null,
          children: goal.children.map((c) => ({
            id: c.id,
            name: c.name,
            percent: c.percent,
            status: c.status,
          })),
        }),
      },
    ],
  };
}

export function registerGetGoalTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_goal",
    {
      title: "Get goal",
      description:
        "One goal's full detail — progress mode, current/target values, dates, owner — plus a summary of its direct children. Get ids from list_goals.",
      inputSchema: {
        goalId: z.string().uuid(),
        orgId: z.string().uuid().optional(),
      },
    },
    async (args) => getGoalHandler(getClient, args),
  );
}
