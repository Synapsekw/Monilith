import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type GetClient = () => Promise<SupabaseClient<Database>>;

export async function listBoardsHandler(getClient: GetClient) {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from("boards")
    .select("id, name, org_id, organizations(name)")
    .is("archived_at", null)
    .order("name", { ascending: true });
  if (error) {
    return {
      content: [{ type: "text" as const, text: error.message }],
      isError: true,
    };
  }
  const boards = (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    orgId: b.org_id,
    orgName: (b.organizations as { name: string } | null)?.name ?? null,
  }));
  return { content: [{ type: "text" as const, text: JSON.stringify(boards) }] };
}

export function registerListBoardsTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "list_boards",
    {
      title: "List boards",
      description: "List boards visible to the connected user.",
      inputSchema: {},
    },
    async () => listBoardsHandler(getClient),
  );
}
