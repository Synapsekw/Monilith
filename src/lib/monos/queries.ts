import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { toBrain, type MonoBoard, type MyMono } from "./types";

type Client = SupabaseClient<Database>;

/** The caller's own Mono in `orgId`, or null. One point read on
 *  `monos_one_per_owner (org_id, owner_id)` through the owner-only RPC (the
 *  only path that returns `brain`). */
export async function getMyMono(
  supabase: Client,
  orgId: string,
): Promise<MyMono | null> {
  const { data, error } = await supabase.rpc("get_my_mono", {
    p_org_id: orgId,
  });
  if (error) throw new Error(`getMyMono: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  // Codegen types `key_provider` and `last_seen_at` as non-null, but both are
  // NULL at runtime for a Mono with no key / that never ran: treat as nullable.
  return {
    userId: row.user_id,
    orgId: row.org_id,
    ownerId: row.owner_id,
    name: row.name,
    color: row.color,
    brain: toBrain(row.brain),
    keyProvider:
      row.key_provider === "anthropic" || row.key_provider === "openai"
        ? row.key_provider
        : null,
    lastSeenAt: (row.last_seen_at as string | null) ?? null,
    createdAt: row.created_at,
  };
}

export const MONO_BOARDS_LIMIT = 100;

/** Boards the Mono is on. RLS-scoped through the owner's client: a Mono is
 *  only ever on boards its owner can open. `board_members_user_id_idx`. */
export async function listMonoBoards(
  supabase: Client,
  monoUserId: string,
): Promise<MonoBoard[]> {
  const { data, error } = await supabase
    .from("board_members")
    .select("board_id, access_level, boards(name)")
    .eq("user_id", monoUserId)
    .limit(MONO_BOARDS_LIMIT);
  if (error) throw new Error(`listMonoBoards: ${error.message}`);
  return (data ?? []).map((r) => ({
    boardId: r.board_id,
    name: r.boards?.name ?? "Untitled board",
    accessLevel: r.access_level,
  }));
}
