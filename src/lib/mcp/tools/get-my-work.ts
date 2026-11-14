import * as z from "zod";
import { getMyWorkItemsCore } from "@/lib/my-work/queries";
import { bucketMyWork } from "@/lib/my-work/bucket";
import { resolveOrgForTool } from "@/lib/mcp/org-scope";
import { todayInTimeZone } from "@/lib/focus/today";
import type { GetClient, ToolResult } from "./shared";
import type { ToolDescriptor } from "./descriptor";

/** Tool-side cap — well under MY_WORK_ITEM_LIMIT (500), which sizes a scrollable
 *  page. An agent reading 200 assigned items already has more than it can use. */
export const MY_WORK_TOOL_LIMIT = 200;

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export async function getMyWorkHandler(
  getClient: GetClient,
  actorId: string,
  args: { orgId?: string } = {},
  now: number = Date.now(),
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    const scope = await resolveOrgForTool(supabase, args.orgId);
    if ("error" in scope) return err(scope.error);

    const result = await getMyWorkItemsCore(supabase, {
      orgId: scope.org.id,
      limit: MY_WORK_TOOL_LIMIT,
    });
    if (!result.ok) return err(result.error);

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("id", actorId)
      .maybeSingle();
    if (profileErr) return err(profileErr.message);
    const { today, timezoneAssumed } = todayInTimeZone(
      profile?.timezone ?? null,
      now,
    );

    // Projection drops status.color — a UI token with no meaning to an agent.
    const groups = bucketMyWork(result.items, today).map((g) => ({
      bucket: g.bucket,
      label: g.label,
      items: g.items.map((i) => ({
        id: i.itemId,
        name: i.itemName,
        boardId: i.boardId,
        boardName: i.boardName,
        groupName: i.groupName,
        dueDate: i.dueDate,
        status: i.status?.label ?? null,
      })),
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            today,
            ...(timezoneAssumed ? { timezoneAssumed: true } : {}),
            groups,
          }),
        },
      ],
    };
  } catch (e) {
    return err((e as Error).message);
  }
}

export const getMyWorkDescriptor: ToolDescriptor = {
  name: "get_my_work",
  title: "Get my work",
  description: `Every open item assigned to the connected user in one organization, earliest due first, grouped by due date (overdue, today, this week, later, no date). Done items are left out. Returns at most ${MY_WORK_TOOL_LIMIT} items. For "what should I do first", use get_focus_today instead.`,
  inputSchema: { orgId: z.string().uuid().optional() },
  capability: null,
  scope: "none",
  invoke: (ctx, input) =>
    getMyWorkHandler(ctx.getClient, ctx.actorId, input as { orgId?: string }),
};
