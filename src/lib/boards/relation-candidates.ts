"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { RelationCandidate } from "@/components/boards/cells/RelationPicker";

const LIMIT_MAX = 100;
const LIMIT_DEFAULT = 50;

const relationCandidatesInputSchema = z.object({
  targetBoardId: z.string().uuid(),
  search: z.string().default(""),
  // Accept any int (fall back to the default on garbage); the actual bound is
  // CLAMPED below. An unclamped client limit would let a caller pull an
  // arbitrarily large result set.
  limit: z.number().int().catch(LIMIT_DEFAULT).default(LIMIT_DEFAULT),
});

/**
 * Escape LIKE/ILIKE wildcards so user search text is matched literally. Postgres
 * treats `%`, `_`, and the escape char `\` specially in LIKE patterns; without
 * this, a search of "50%" or "a_b" would match far more than intended (and a
 * lone `%` would match every row). Escape `\` first, then the wildcards.
 */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Target-board items the caller can read, bounded for the relation picker. RLS
 * scopes to readable boards; `search` is a case-insensitive contains filter on
 * the item name. Bounded by `limit` (default 50, max 100) — on larger boards
 * only the first matches show; search narrows it.
 */
export async function listRelationCandidates(
  targetBoardId: string,
  search = "",
  limit = 50,
): Promise<RelationCandidate[]> {
  const parsed = relationCandidatesInputSchema.safeParse({
    targetBoardId,
    search,
    limit,
  });
  if (!parsed.success) return [];

  const boundedLimit = Math.min(LIMIT_MAX, Math.max(1, parsed.data.limit));
  const supabase = await createClient();
  let q = supabase
    .from("items")
    .select("id, name")
    .eq("board_id", parsed.data.targetBoardId)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .limit(boundedLimit);
  const term = parsed.data.search.trim();
  if (term) q = q.ilike("name", `%${escapeLikePattern(term)}%`);
  const { data } = await q;
  return data ?? [];
}

/** Boards the caller can read (own + shared), for the relation-column target
 *  picker. RLS scopes to readable boards. */
export async function listRelationTargetBoards(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("boards")
    .select("id, name")
    .is("archived_at", null)
    .order("name", { ascending: true });
  return data ?? [];
}

/** Mirrorable (cell_values-backed) columns on a target board, for the mirror
 *  config's target-column picker. RLS-scoped. Excludes derived/side-table kinds.
 *  Lives here (a "use server" module), not in the server-only queries.ts, so the
 *  client MirrorColumnConfig can invoke it as a server action — same posture as
 *  listRelationCandidates above. */
export async function listMirrorableColumns(
  targetBoardId: string,
): Promise<{ id: string; name: string; kind: string }[]> {
  const supabase = await createClient();
  const NON_MIRRORABLE = ["files", "time_tracking", "relation", "mirror"];
  const { data } = await supabase
    .from("columns")
    .select("id, name, kind")
    .eq("board_id", targetBoardId)
    .order("position", { ascending: true });
  return (data ?? []).filter((c) => !NON_MIRRORABLE.includes(c.kind));
}
