import * as z from "zod";
import { resolveOrgForTool } from "@/lib/mcp/org-scope";
import type { GetClient, ToolResult } from "./shared";
import type { ToolDescriptor } from "./descriptor";

export const SEARCH_LIMIT = 20;
const FOLDER_BOARD_LIMIT = 200;

const searchItemsInput = {
  query: z.string().trim().min(2).max(100),
  orgId: z.string().uuid().optional(),
  boardId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
};

type Args = {
  query: string;
  orgId?: string;
  boardId?: string;
  folderId?: string;
};

type Hit = {
  id: string;
  name: string;
  boardId: string;
  board: string;
  matchedOn: "name" | "content";
};

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function ok(body: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

/**
 * Find items by name AND by meaning, scoped to one board, one project folder or
 * the whole organization.
 *
 * Name matches are bounded to {@link SEARCH_LIMIT} and over-fetch by one, so
 * `truncated` is true only when a genuine extra match exists. Semantic matches
 * come from `semanticSearchCore`; when that is unavailable (AI off, quota,
 * provider error) the result is name-only and says so, so a caller never reads
 * "no matches" as "nothing exists".
 */
export async function searchItemsHandler(
  getClient: GetClient,
  actorId: string,
  input: Args,
): Promise<ToolResult> {
  if (input.boardId && input.folderId)
    return err("Pass boardId or folderId, not both.");

  const supabase = await getClient();
  const scope = await resolveOrgForTool(supabase, input.orgId);
  if ("error" in scope) return err(scope.error);
  const orgId = scope.org.id;

  let boardIds: string[] | undefined;
  if (input.boardId) boardIds = [input.boardId];
  if (input.folderId) {
    const { data, error } = await supabase
      .from("folder_boards")
      .select("board_id")
      .eq("folder_id", input.folderId)
      .limit(FOLDER_BOARD_LIMIT);
    if (error) return err(error.message);
    boardIds = (data ?? []).map((r) => r.board_id);
    if (boardIds.length === 0)
      return ok({ items: [], semantic: true, truncated: false });
  }

  let nameQ = supabase
    .from("items")
    .select("id, name, board_id")
    .eq("org_id", orgId)
    .is("archived_at", null)
    .ilike("name", `%${input.query}%`)
    .order("updated_at", { ascending: false })
    .limit(SEARCH_LIMIT + 1);
  if (boardIds) nameQ = nameQ.in("board_id", boardIds);

  // Dynamic import: the semantic path pulls in server-only modules, and this
  // descriptor is reachable from catalog.ts, which client components import.
  const { semanticSearchCore } =
    await import("@/lib/ai/embeddings/semantic-core");
  const [names, semantic] = await Promise.all([
    nameQ,
    semanticSearchCore(supabase, {
      orgId,
      userId: actorId,
      query: input.query,
      boardIds,
      limit: SEARCH_LIMIT,
    }),
  ]);
  if (names.error) return err(names.error.message);

  const nameRows = names.data ?? [];
  const truncated = nameRows.length > SEARCH_LIMIT;
  const nameBoardIds = [...new Set(nameRows.map((r) => r.board_id))];
  const { data: boards } = nameBoardIds.length
    ? await supabase
        .from("boards")
        .select("id, name")
        .in("id", nameBoardIds)
        .is("archived_at", null)
    : { data: [] as { id: string; name: string }[] };
  const boardName = new Map((boards ?? []).map((b) => [b.id, b.name]));

  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const r of nameRows.slice(0, SEARCH_LIMIT)) {
    const board = boardName.get(r.board_id);
    if (!board) continue; // archived or unreadable board
    seen.add(r.id);
    hits.push({
      id: r.id,
      name: r.name,
      boardId: r.board_id,
      board,
      matchedOn: "name",
    });
  }
  if (semantic.ok)
    for (const s of semantic.items) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      hits.push({
        id: s.id,
        name: s.name,
        boardId: s.boardId,
        board: s.boardName,
        matchedOn: "content",
      });
    }

  return ok({
    items: hits.slice(0, SEARCH_LIMIT),
    semantic: semantic.ok,
    truncated,
    ...(semantic.ok
      ? {}
      : {
          note: "Search by meaning was unavailable, so this searched item names only. An item described in other words may exist.",
        }),
  });
}

export const searchItemsDescriptor: ToolDescriptor = {
  name: "search_items",
  title: "Search items",
  description: `Find items by name and by meaning across one board (boardId), one project folder (folderId) or the whole organization (neither). Returns at most ${SEARCH_LIMIT} items with their board and whether they matched on name or content. When \`semantic\` is false only names were searched.`,
  inputSchema: searchItemsInput,
  capability: null,
  scope: "boardId",
  invoke: (ctx, input) =>
    searchItemsHandler(ctx.getClient, ctx.actorId, input as Args),
};
