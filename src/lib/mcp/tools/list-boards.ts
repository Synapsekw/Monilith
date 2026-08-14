import type { GetClient } from "./shared";
import type { ToolDescriptor } from "./descriptor";

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

export const listBoardsDescriptor: ToolDescriptor = {
  name: "list_boards",
  title: "List boards",
  description: "List boards visible to the connected user.",
  inputSchema: {},
  capability: null,
  scope: "none",
  invoke: (ctx) => listBoardsHandler(ctx.getClient),
};
