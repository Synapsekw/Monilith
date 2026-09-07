import { z } from "zod";
import {
  createDashboardCore,
  deleteDashboardCore,
  duplicateDashboardCore,
  renameDashboardCore,
  saveLayoutCore,
} from "@/lib/dashboards/core";
import { resolveOrgForTool } from "@/lib/mcp/org-scope";
import {
  parseAction,
  toToolResult,
  type GetClient,
  type ToolResult,
} from "./shared";
import type { ToolDescriptor } from "./descriptor";

const uuid = z.string().uuid();
const dashboardName = z.string().trim().min(1).max(100);

/** One widget's grid rectangle. Mirrors `saveLayoutSchema`'s `gridRect`; the
 *  core re-validates, so this is the shape the agent sees, not the boundary. */
const layoutRect = z.object({
  id: uuid,
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
});

/**
 * `action` is a `z.enum` in the RAW SHAPE and the discriminant of the union
 * below. Both matter: the raw shape is what the MCP SDK and the AI SDK validate
 * against before dispatch, and — because `scopeFor` falls back to scope `"none"`
 * for an action it does not recognise — an action that could reach the handler
 * without appearing in the enum would silently bypass its declared entry.
 */
export const manageDashboardInput = {
  action: z.enum(["create", "rename", "duplicate", "delete", "save_layout"]),
  dashboardId: uuid.optional(),
  name: dashboardName.optional(),
  orgId: uuid.optional(),
  workspaceId: uuid.optional(),
  layout: z.array(layoutRect).max(100).optional(),
};

const manageDashboardAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: dashboardName,
    orgId: uuid.optional(),
    workspaceId: uuid.optional(),
  }),
  z.object({
    action: z.literal("rename"),
    dashboardId: uuid,
    name: dashboardName,
  }),
  z.object({ action: z.literal("duplicate"), dashboardId: uuid }),
  z.object({ action: z.literal("delete"), dashboardId: uuid }),
  z.object({
    action: z.literal("save_layout"),
    dashboardId: uuid,
    layout: z.array(layoutRect).max(100),
  }),
]);

type Args = z.infer<typeof manageDashboardAction>;

export async function manageDashboardHandler(
  getClient: GetClient,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parseAction(manageDashboardAction, input);
  if (!parsed.ok) return parsed.result;
  const args: Args = parsed.value;

  // ONCE per invocation: each call charges the MCP rate limit and rotates the
  // OAuth bridge secret. Every branch below reuses this one client.
  const supabase = await getClient();

  if (args.action === "create") {
    // `create_dashboard` derives the org from the WORKSPACE, so a dashboard
    // cannot be created from an org id alone. Resolve the org first (an
    // explicitly requested org that is not a membership is refused outright,
    // never swapped for another one), then pick a workspace inside it.
    const scope = await resolveOrgForTool(supabase, args.orgId);
    if ("error" in scope)
      return { content: [{ type: "text", text: scope.error }], isError: true };

    let workspaceId = args.workspaceId;
    if (!workspaceId) {
      // The org's first workspace by creation time — the same ordering the
      // workspace switcher lists, so "the default workspace" means the same
      // thing to an agent as it does on screen.
      const { data: workspace } = await supabase
        .from("workspaces")
        .select("id")
        .eq("org_id", scope.org.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!workspace)
        return {
          content: [
            {
              type: "text",
              text: `Organization ${scope.org.name} has no workspace to create a dashboard in.`,
            },
          ],
          isError: true,
        };
      workspaceId = workspace.id;
    }

    const res = await createDashboardCore(supabase, {
      workspaceId,
      name: args.name,
    });
    if (!res.ok) return toToolResult(res);
    return toToolResult({
      ok: true,
      data: {
        dashboardId: res.data.dashboard.id,
        name: res.data.dashboard.name,
        orgId: res.data.dashboard.org_id,
        workspaceId: res.data.dashboard.workspace_id,
      },
    });
  }

  if (args.action === "rename") {
    const res = await renameDashboardCore(supabase, {
      dashboardId: args.dashboardId,
      name: args.name,
    });
    if (!res.ok) return toToolResult(res);
    return toToolResult({
      ok: true,
      data: {
        dashboardId: res.data.dashboard.id,
        name: res.data.dashboard.name,
      },
    });
  }

  if (args.action === "duplicate") {
    const res = await duplicateDashboardCore(supabase, {
      dashboardId: args.dashboardId,
    });
    if (!res.ok) return toToolResult(res);
    return toToolResult({
      ok: true,
      data: { dashboardId: res.data.dashboardId },
    });
  }

  if (args.action === "delete") {
    const res = await deleteDashboardCore(supabase, {
      dashboardId: args.dashboardId,
    });
    if (!res.ok) return toToolResult(res);
    // `orgId: null` means the delete matched no row — RLS-invisible or already
    // gone. Report it rather than claiming a deletion that did not happen.
    if (res.data.orgId === null)
      return {
        content: [
          { type: "text", text: `Dashboard ${args.dashboardId} not found.` },
        ],
        isError: true,
      };
    return toToolResult({
      ok: true,
      data: { dashboardId: res.data.dashboardId, deleted: true },
    });
  }

  const res = await saveLayoutCore(supabase, {
    dashboardId: args.dashboardId,
    layouts: args.layout,
  });
  return toToolResult(res);
}

export const manageDashboardDescriptor: ToolDescriptor = {
  name: "manage_dashboard",
  title: "Manage dashboard",
  description:
    "Create, rename, duplicate or delete a dashboard, or save its widget layout. `create` takes a `name` (plus `orgId` if you belong to more than one organization — list_organizations — and `workspaceId` to choose a workspace other than the org's first); every other action takes a `dashboardId` from list_dashboards. `duplicate` copies the dashboard's widgets into a new dashboard. `delete` removes the dashboard and cascades to its widgets. `save_layout` replaces the grid rectangle of every widget you pass — send the full set, not a diff. Add widgets with manage_widget.",
  inputSchema: manageDashboardInput,
  // Structure edits, except `delete`, which is not recoverable from here.
  capability: {
    create: "board.structure",
    rename: "board.structure",
    duplicate: "board.structure",
    delete: "board.destroy",
    save_layout: "board.structure",
  },
  // A dashboard's widgets can source from MANY boards, so "the board this call
  // addresses" has no single answer — board_scope has nothing to say and RLS is
  // the boundary. Same reasoning `descriptor.ts` records for get_dashboard.
  scope: {
    create: "none",
    rename: "none",
    duplicate: "none",
    delete: "none",
    save_layout: "none",
  },
  // A dashboard is a new top-level object addressing no existing board.
  unscopedCreateActions: ["create"],
  invoke: (ctx, input) => manageDashboardHandler(ctx.getClient, input),
};
