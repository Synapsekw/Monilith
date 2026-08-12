import { listToolOrgs } from "@/lib/mcp/org-scope";
import type { GetClient, ToolResult } from "./shared";
import type { ToolDescriptor } from "./descriptor";

export async function listOrganizationsHandler(
  getClient: GetClient,
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    const orgs = await listToolOrgs(supabase);
    return { content: [{ type: "text", text: JSON.stringify(orgs) }] };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export const listOrganizationsDescriptor: ToolDescriptor = {
  name: "list_organizations",
  title: "List organizations",
  description:
    "List the organizations the connected user belongs to. Use the returned id as the optional `orgId` argument on org-scoped tools.",
  inputSchema: {},
  capability: null,
  scope: "none",
  invoke: (ctx) => listOrganizationsHandler(ctx.getClient),
};
