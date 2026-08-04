import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

/**
 * `board_id` is carried even though `listBoardThreads` already filters on it:
 * the two groups share one row component, and without it the list cannot tell a
 * docked thread from a boardless briefing — so it would offer the share toggle
 * on a thread the shared-read policy can never match (its first conjunct is
 * `board_id is not null`).
 */
export type BoardThreadRow = Pick<
  Database["public"]["Tables"]["ai_conversations"]["Row"],
  | "id"
  | "title"
  | "updated_at"
  | "agent_id"
  | "board_id"
  | "visibility"
  | "user_id"
>;

const COLUMNS =
  "id, title, updated_at, agent_id, board_id, visibility, user_id";

/** Bounded hot-path reads (working agreement #5). 50 threads is far past what a
 *  dock can show without scrolling; the cap exists so the read stays constant
 *  as a board ages. */
export const BOARD_THREADS_LIMIT = 50;
/** The dock shows only the most recent agent threads; the full set lives on /ask. */
export const AGENT_THREADS_LIMIT = 5;

/**
 * Threads on one board: the caller's own, plus any shared to the board by
 * someone else.
 *
 * Deliberately NOT filtered by `user_id` — unlike `listConversations`, whose
 * explicit filter both scopes and keeps the read on the (user_id, updated_at)
 * index. Here RLS is the scope: `ai_conversations_select_own` returns the
 * caller's rows and `ai_conversations_select_board_shared` adds the shared
 * ones. Adding a user_id filter would silently hide every shared thread.
 */
export async function listBoardThreads(
  boardId: string,
): Promise<BoardThreadRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select(COLUMNS)
    .eq("board_id", boardId)
    .order("updated_at", { ascending: false })
    .limit(BOARD_THREADS_LIMIT);
  if (error) throw new Error(`listBoardThreads: ${error.message}`);
  return data ?? [];
}

/**
 * The owner's cross-board agent threads — where a scheduled briefing lands. A
 * briefing reads every board its owner can see, so it has no single board and
 * `board_id` is null by construction.
 */
export async function listAgentThreads(
  userId: string,
): Promise<BoardThreadRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select(COLUMNS)
    .eq("user_id", userId)
    .is("board_id", null)
    .not("agent_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(AGENT_THREADS_LIMIT);
  if (error) throw new Error(`listAgentThreads: ${error.message}`);
  return data ?? [];
}
