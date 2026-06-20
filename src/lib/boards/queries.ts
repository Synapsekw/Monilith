import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

export type Board = Tables<"boards">;
export type Group = Tables<"groups">;
export type Item = Tables<"items">;
export type Column = Tables<"columns">;
export type CellValue = Tables<"cell_values">;
export type BoardView = Tables<"board_views">;
export type ItemDependency = Tables<"item_dependencies">;
export type Automation = Tables<"automations">;
export type Attachment = Tables<"attachments">;
export type TimeEntry = Tables<"time_entries">;

export type BoardPayload = {
  board: Board;
  groups: Group[];
  columns: Column[];
  items: Item[];
  cellValues: CellValue[];
  views: BoardView[];
  dependencies: ItemDependency[];
  attachments: Attachment[];
  timeEntries: TimeEntry[];
};

export type BoardListEntry = Pick<
  Board,
  "id" | "name" | "workspace_id" | "position"
>;

/** All boards visible to the current user (RLS-scoped), for the sidebar. */
export async function listBoards(): Promise<BoardListEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .select("id, name, workspace_id, position")
    .order("position", { ascending: true });
  if (error) return [];
  return data ?? [];
}

/**
 * Batched read of a board's full payload. Returns null when the board is not
 * visible (RLS) or does not exist. Seven parallel RLS-scoped reads — no joins,
 * no N+1. Attachments are bounded to the most recent 200 files-column rows.
 */
export async function getBoardPayload(
  boardId: string,
): Promise<BoardPayload | null> {
  const supabase = await createClient();

  const { data: board, error: boardErr } = await supabase
    .from("boards")
    .select("*")
    .eq("id", boardId)
    .maybeSingle();
  if (boardErr || !board) return null;

  const [
    groupsRes,
    columnsRes,
    itemsRes,
    cellsRes,
    viewsRes,
    depsRes,
    attachmentsRes,
    timeEntriesRes,
  ] = await Promise.all([
    supabase
      .from("groups")
      .select("*")
      .eq("board_id", boardId)
      .order("position", { ascending: true }),
    supabase
      .from("columns")
      .select("*")
      .eq("board_id", boardId)
      .order("position", { ascending: true }),
    supabase
      .from("items")
      .select("*")
      .eq("board_id", boardId)
      .order("position", { ascending: true }),
    supabase.from("cell_values").select("*").eq("board_id", boardId),
    supabase
      .from("board_views")
      .select("*")
      .eq("board_id", boardId)
      .order("position", { ascending: true }),
    supabase
      .from("item_dependencies")
      .select("*")
      .eq("board_id", boardId)
      .order("created_at", { ascending: true }),
    supabase
      .from("attachments")
      .select("*")
      .eq("board_id", boardId)
      .not("column_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
    // Bounded by time_entries_board_idx. Limit 1000 matches the first-paint
    // budget for v1 (same tradeoff as attachments/.limit(200)). If a board
    // exceeds this, running totals could undercount — a server-side aggregate
    // is the documented follow-up (spec §8).
    supabase
      .from("time_entries")
      .select("*")
      .eq("board_id", boardId)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  return {
    board,
    groups: groupsRes.data ?? [],
    columns: columnsRes.data ?? [],
    items: itemsRes.data ?? [],
    cellValues: cellsRes.data ?? [],
    views: viewsRes.data ?? [],
    dependencies: depsRes.data ?? [],
    attachments: attachmentsRes.data ?? [],
    timeEntries: timeEntriesRes.data ?? [],
  };
}

export type OrgMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

/**
 * Members of an org with their profile display info, for the People cell
 * editor. RLS-scoped: only members of the org can read its org_members rows.
 *
 * Uses a two-query JS join because `org_members → profiles` has no declared FK
 * relationship in database.types.ts (user_id references auth.users, not
 * profiles), so the nested PostgREST embed does not typecheck.
 */
export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const supabase = await createClient();

  const { data: members, error: membersErr } = await supabase
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId);
  if (membersErr || !members || members.length === 0) return [];

  const userIds = members.map((m) => m.user_id);

  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", userIds);
  if (profilesErr || !profiles) return [];

  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  return userIds.map((userId) => {
    const profile = profileMap.get(userId) ?? null;
    return {
      userId,
      fullName: profile?.full_name ?? null,
      email: profile?.email ?? null,
      avatarUrl: profile?.avatar_url ?? null,
    };
  });
}

export async function listAutomations(boardId: string): Promise<Automation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automations")
    .select("*")
    .eq("board_id", boardId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
