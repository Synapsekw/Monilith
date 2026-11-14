import * as z from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
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

/** Escape LIKE wildcards so the user's text is matched literally. */
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, "\\$&");
}

type SemanticResult = Awaited<
  ReturnType<
    typeof import("@/lib/ai/embeddings/semantic-core").semanticSearchCore
  >
>;

/**
 * Semantic search never fails the tool: an import or runtime failure reports
 * `ok: false`, and the caller says it searched names only.
 *
 * Dynamic import: the semantic path pulls in server-only modules, and this
 * descriptor is reachable from catalog.ts, which client components import.
 */
async function runSemantic(
  supabase: SupabaseClient<Database>,
  args: Parameters<
    typeof import("@/lib/ai/embeddings/semantic-core").semanticSearchCore
  >[1],
): Promise<SemanticResult> {
  try {
    const { semanticSearchCore } =
      await import("@/lib/ai/embeddings/semantic-core");
    return await semanticSearchCore(supabase, args);
  } catch {
    return { ok: false };
  }
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

  // Archived boards are excluded IN the query (inner join + filter), so the
  // limit applies to rows that can actually be returned. Filtering after the
  // limit would let archived rows crowd out real matches and make `truncated`
  // lie. `%`, `_` and `\` are escaped so the user's text is a literal.
  let nameQ = supabase
    .from("items")
    .select("id, name, board_id, boards!inner(name)")
    .eq("org_id", orgId)
    .is("archived_at", null)
    .is("boards.archived_at", null)
    .ilike("name", `%${escapeLike(input.query)}%`)
    .order("updated_at", { ascending: false })
    .limit(SEARCH_LIMIT + 1);
  if (boardIds) nameQ = nameQ.in("board_id", boardIds);

  const [names, semantic] = await Promise.all([
    nameQ,
    runSemantic(supabase, {
      orgId,
      userId: actorId,
      query: input.query,
      boardIds,
      limit: SEARCH_LIMIT,
    }),
  ]);
  if (names.error) return err(names.error.message);

  const nameRows = names.data ?? [];
  const nameTruncated = nameRows.length > SEARCH_LIMIT;

  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const r of nameRows.slice(0, SEARCH_LIMIT)) {
    seen.add(r.id);
    hits.push({
      id: r.id,
      name: r.name,
      boardId: r.board_id,
      board: r.boards.name,
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

  // Truncated when EITHER the name query had a further match OR the merged
  // list was cut by the final cap.
  const truncated = nameTruncated || hits.length > SEARCH_LIMIT;

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
