import * as z from "zod";
import { FOCUS_LIMIT, getFocusTodayCore } from "@/lib/focus/queries";
import type { FocusTier } from "@/lib/focus/reason";
import { resolveOrgForTool } from "@/lib/mcp/org-scope";
import type { GetClient, ToolResult } from "./shared";
import type { ToolDescriptor } from "./descriptor";

const TIER_NAME: Record<FocusTier, string> = {
  1: "overdue",
  2: "blocking",
  3: "dueSoon",
  4: "waitingOnReply",
  5: "stalled",
};

export async function getFocusTodayHandler(
  getClient: GetClient,
  actorId: string,
  args: { orgId?: string; folderId?: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  const scope = await resolveOrgForTool(supabase, args.orgId);
  if ("error" in scope)
    return { content: [{ type: "text", text: scope.error }], isError: true };

  const res = await getFocusTodayCore(supabase, {
    orgId: scope.org.id,
    userId: actorId,
    ...(args.folderId ? { folderId: args.folderId } : {}),
  });
  if (!res.ok)
    return { content: [{ type: "text", text: res.error }], isError: true };

  const { today, timezoneAssumed, items, totals } = res.data;
  const body = {
    today,
    ...(timezoneAssumed ? { timezoneAssumed: true } : {}),
    items: items.map((i) => ({
      id: i.itemId,
      name: i.itemName,
      boardId: i.boardId,
      board: i.boardName,
      group: i.groupName,
      status: i.status,
      dueDate: i.dueDate,
      tier: TIER_NAME[i.tier],
      reason: i.reason,
    })),
    totals: {
      overdue: totals[1],
      blocking: totals[2],
      dueSoon: totals[3],
      waitingOnReply: totals[4],
      stalled: totals[5],
    },
    ...(items.length === 0
      ? {
          note: "Nothing urgent: no open item of theirs is overdue, blocking someone, due within two days, waiting on a reply or stalled. Use get_my_work for the full list.",
        }
      : {}),
  };
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

export const getFocusTodayDescriptor: ToolDescriptor = {
  name: "get_focus_today",
  title: "Get focus for today",
  description: `What the connected user should work on first, already ranked: overdue, then items blocking someone else, then due within two days, then unread replies, then stalled work. Returns at most ${FOCUS_LIMIT} items in order, each with the reason it is there, plus how many items each tier holds in total (a tier cut off by the limit reports 0). Pass folderId to limit it to one project. Present the items in the order given and explain them with the reasons given; do not re-rank.`,
  inputSchema: {
    orgId: z.string().uuid().optional(),
    folderId: z.string().uuid().optional(),
  },
  capability: null,
  scope: "none",
  invoke: (ctx, input) =>
    getFocusTodayHandler(
      ctx.getClient,
      ctx.actorId,
      input as { orgId?: string; folderId?: string },
    ),
};
