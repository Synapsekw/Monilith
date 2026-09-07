import { z } from "zod";
import {
  createGoalCore,
  deleteGoalCore,
  setGoalLinksCore,
  updateGoalCore,
} from "@/lib/goals/core";
import { goalProgressMode, goalStatus } from "@/lib/validations/goals";
import { resolveOrgForTool } from "@/lib/mcp/org-scope";
import {
  parseAction,
  toToolResult,
  type GetClient,
  type ToolResult,
} from "./shared";
import type { ToolDescriptor } from "./descriptor";

const uuid = z.string().uuid();
const goalName = z.string().trim().min(1).max(200);
const percent = z.number().min(0).max(100);

/** The measurable fields, shared by `create` and `update`. Every one is
 *  `.optional()` and most are `.nullable()`: Zod leaves an absent key ABSENT in
 *  its output, which is exactly what `updateGoalCore`'s `"key" in input` patch
 *  builder needs to tell "leave it alone" from "clear it". */
const goalFields = {
  ownerId: uuid.optional(),
  parentGoalId: uuid.nullable().optional(),
  workspaceId: uuid.nullable().optional(),
  status: goalStatus.optional(),
  startValue: z.number().nullable().optional(),
  currentValue: z.number().nullable().optional(),
  targetValue: z.number().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  percent: percent.nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
};

const goalLink = z.object({
  boardId: uuid,
  doneColumnId: uuid.nullable(),
  doneOptionIds: z.array(uuid),
});

/** See `manage-dashboard.ts`: the enum is what keeps `scopeFor` from falling
 *  back for an action nobody declared. */
export const manageGoalInput = {
  action: z.enum(["create", "update", "set_links", "delete"]),
  goalId: uuid.optional(),
  name: goalName.optional(),
  description: z.string().max(2000).nullable().optional(),
  orgId: uuid.optional(),
  progressMode: goalProgressMode.optional(),
  links: z.array(goalLink).max(200).optional(),
  ...goalFields,
};

const manageGoalAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: goalName,
    orgId: uuid.optional(),
    // The app's own default in NewGoalDialog. A goal with a name and nothing
    // else is a legitimate agent request; forcing a progress model on the model
    // would only make it guess one.
    progressMode: goalProgressMode.default("manual_percent"),
    ...goalFields,
  }),
  z.object({
    action: z.literal("update"),
    goalId: uuid,
    name: goalName.optional(),
    description: z.string().max(2000).nullable().optional(),
    progressMode: goalProgressMode.optional(),
    ...goalFields,
  }),
  z.object({
    action: z.literal("set_links"),
    goalId: uuid,
    links: z.array(goalLink).max(200),
  }),
  z.object({ action: z.literal("delete"), goalId: uuid }),
]);

type Args = z.infer<typeof manageGoalAction>;

export async function manageGoalHandler(
  getClient: GetClient,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parseAction(manageGoalAction, input);
  if (!parsed.ok) return parsed.result;
  const args: Args = parsed.value;

  // ONCE per invocation (rate limit + bridge-secret rotation).
  const supabase = await getClient();

  if (args.action === "create") {
    // The MCP analogue of the active-org cookie. `resolveToolOrg` differs from
    // `pickActiveOrg` on purpose: an explicitly requested org that is not a
    // membership is REFUSED, never silently swapped for another tenant's org.
    //
    // NOTE this is a MEMBERSHIP CHECK, not a destination: `create_goal`
    // (supabase/migrations/20260621160000_goals.sql:159) derives the row's
    // org_id itself via `select org_id from org_members where user_id = v_uid
    // limit 1` — no ORDER BY, so for a caller in >1 org the result is
    // arbitrary and `orgId` here does not steer it. Don't "fix" this by
    // threading `scope.orgId` into `createGoalCore`; the RPC ignores it.
    const scope = await resolveOrgForTool(supabase, args.orgId);
    if ("error" in scope)
      return { content: [{ type: "text", text: scope.error }], isError: true };

    const { action: _action, orgId: _orgId, ...fields } = args;
    const res = await createGoalCore(supabase, fields);
    if (!res.ok) return toToolResult(res);
    const goal = res.data.goal;
    // Echo the org the row ACTUALLY landed in: `create_goal` is a SECURITY
    // DEFINER function that derives the org from the caller's own membership
    // rather than taking one, so for a multi-org caller the resolved org above
    // is a permission check, not a destination.
    return toToolResult({
      ok: true,
      data: {
        goalId: goal.id,
        name: goal.name,
        progressMode: goal.progress_mode,
        orgId: goal.org_id,
      },
    });
  }

  if (args.action === "update") {
    const { action: _action, ...fields } = args;
    const res = await updateGoalCore(supabase, fields);
    if (!res.ok) return toToolResult(res);
    const goal = res.data.goal;
    return toToolResult({
      ok: true,
      data: {
        goalId: goal.id,
        name: goal.name,
        progressMode: goal.progress_mode,
        status: goal.status,
        percent: goal.percent,
      },
    });
  }

  if (args.action === "set_links") {
    const res = await setGoalLinksCore(supabase, {
      goalId: args.goalId,
      links: args.links,
    });
    if (!res.ok) return toToolResult(res);
    return toToolResult({
      ok: true,
      data: { goalId: args.goalId, links: args.links.length },
    });
  }

  const res = await deleteGoalCore(supabase, { goalId: args.goalId });
  if (!res.ok) return toToolResult(res);
  return toToolResult({
    ok: true,
    data: { goalId: args.goalId, deleted: true },
  });
}

export const manageGoalDescriptor: ToolDescriptor = {
  name: "manage_goal",
  title: "Manage goal",
  description:
    "Create, update or delete a goal, or set the boards a goal's progress is computed from. `create` needs a `name`; `progressMode` defaults to manual_percent (the others are manual_number, auto_subgoals and auto_boards). The goal is created in your default organization; pass `orgId` only to confirm you belong to the org you expect (list_organizations) — it does NOT choose the destination, and an org you are not a member of is refused, never substituted — the response's `orgId` is the org it actually landed in. Every other action takes a `goalId` from list_goals. `set_links` REPLACES the whole link set: send every board the goal should follow, each with the status column and the option ids that count as done (get_board lists them). Auto-computed progress needs progressMode auto_boards.",
  inputSchema: manageGoalInput,
  capability: {
    create: "board.structure",
    update: "board.structure",
    set_links: "board.structure",
    delete: "board.destroy",
  },
  // A goal is org-wide and may link MANY boards, so no single board id is "the"
  // board this call addresses — board_scope has nothing to narrow and RLS is
  // the boundary. Same reasoning `descriptor.ts` records for get_dashboard /
  // get_report.
  scope: { create: "none", update: "none", set_links: "none", delete: "none" },
  // A goal is a new top-level object addressing no existing board.
  unscopedCreateActions: ["create"],
  invoke: (ctx, input) => manageGoalHandler(ctx.getClient, input),
};
