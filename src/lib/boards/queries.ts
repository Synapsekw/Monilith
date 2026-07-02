import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import type { Tables } from "@/types/database.types";
import type { RelationLink } from "@/lib/boards/relations";

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
  relationLinks: RelationLink[];
  /** (linked item, target column) cell values for mirror columns, RLS-scoped. */
  mirrorTargetCells: CellValue[];
  /** Render metadata for the columns referenced by mirror columns. */
  mirrorTargetColumns: Pick<Column, "id" | "kind" | "settings">[];
};

export type BoardListEntry = Pick<
  Board,
  "id" | "name" | "workspace_id" | "position"
> & { shared_out: boolean };

export type SharedBoardEntry = {
  id: string;
  name: string;
  position: number;
  owner_name: string | null;
  access_level: "viewer" | "editor";
};

/** Boards the current user owns (created_by = me), with a shared-out flag. */
export async function listMyBoards(): Promise<BoardListEntry[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .select("id, name, workspace_id, position, board_members(user_id)")
    .eq("created_by", user.id)
    .order("position", { ascending: true });
  if (error) return [];
  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    workspace_id: b.workspace_id,
    position: b.position,
    shared_out: (b.board_members ?? []).length > 0,
  }));
}

/** Boards shared WITH the current user by someone else. */
export async function listSharedBoards(): Promise<SharedBoardEntry[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_members")
    .select("access_level, boards!inner(id, name, position, created_by)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  const rows = data.filter((r) => r.boards && r.boards.created_by !== user.id);

  const ownerIds = [...new Set(rows.map((r) => r.boards.created_by))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ownerIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return rows.map((r) => ({
    id: r.boards.id,
    name: r.boards.name,
    position: r.boards.position,
    owner_name: nameById.get(r.boards.created_by) ?? null,
    access_level: r.access_level,
  }));
}

/** The current user's effective access to a board (or null if none). */
export async function getBoardAccess(
  boardId: string,
): Promise<"owner" | "editor" | "viewer" | null> {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("created_by")
    .eq("id", boardId)
    .maybeSingle();
  if (!board) return null;
  if (board.created_by === user.id) return "owner";
  const { data: grant } = await supabase
    .from("board_members")
    .select("access_level")
    .eq("board_id", boardId)
    .eq("user_id", user.id)
    .maybeSingle();
  return grant?.access_level ?? null;
}

/**
 * Batched read of a board's full payload. Returns null when the board is not
 * visible (RLS) or does not exist. Nine parallel RLS-scoped reads — no joins,
 * no N+1. Attachments are bounded to the most recent 200 files-column rows.
 * Relation links and mirror cells trigger two further bounded follow-up reads
 * (linked-item names; mirror target cells + target-column metadata) only when
 * the board actually has those columns.
 */
export const getBoardPayload = cache(
  async (boardId: string): Promise<BoardPayload | null> => {
    const supabase = await createClient();

    const { data: board, error: boardErr } = await supabase
      .from("boards")
      .select("*")
      .eq("id", boardId)
      .maybeSingle();
    // A DB failure is not a 404: throw so the boards error boundary renders
    // (spec F5 / decision D6). Missing/RLS-hidden row stays null → notFound().
    if (boardErr) throw new Error(`Failed to load board: ${boardErr.message}`);
    if (!board) return null;

    const [
      groupsRes,
      columnsRes,
      itemsRes,
      cellsRes,
      viewsRes,
      depsRes,
      attachmentsRes,
      timeEntriesRes,
      relationLinksRes,
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
      // Bounded by relation_links_board_idx. Linked-item NAMES are resolved in a
      // second RLS-scoped query below (the targets live on another board).
      supabase
        .from("relation_links")
        .select("*")
        .eq("board_id", boardId)
        .order("position", { ascending: true })
        .limit(2000),
    ]);

    // A silently-empty board (every `.data ?? []` below) is indistinguishable
    // from deleted data. Fail loudly; the segment error boundary offers retry.
    const reads: [string, { error: { message: string } | null }][] = [
      ["groups", groupsRes],
      ["columns", columnsRes],
      ["items", itemsRes],
      ["cell values", cellsRes],
      ["views", viewsRes],
      ["dependencies", depsRes],
      ["attachments", attachmentsRes],
      ["time entries", timeEntriesRes],
      ["relation links", relationLinksRes],
    ];
    for (const [name, res] of reads)
      if (res.error)
        throw new Error(`Failed to load board ${name}: ${res.error.message}`);

    // Resolve linked-item names (targets are on other boards). RLS auto-filters
    // to readable boards → a name the caller can't see stays null (chip omitted).
    const rawLinks = relationLinksRes.data ?? [];
    const linkedIds = [...new Set(rawLinks.map((l) => l.linked_item_id))];
    const namesById = new Map<string, string>();
    if (linkedIds.length > 0) {
      const { data: linkedItems, error: linkedErr } = await supabase
        .from("items")
        .select("id, name")
        .in("id", linkedIds);
      if (linkedErr)
        throw new Error(
          `Failed to load board linked items: ${linkedErr.message}`,
        );
      for (const it of linkedItems ?? []) namesById.set(it.id, it.name);
    }
    const relationLinks: RelationLink[] = rawLinks.map((l) => ({
      id: l.id,
      itemId: l.item_id,
      columnId: l.column_id,
      linkedItemId: l.linked_item_id,
      linkedItemName: namesById.get(l.linked_item_id) ?? null,
      position: l.position,
    }));

    // Mirror source hydration: read the (linked item, target column) cells the
    // caller can see — RLS auto-filters unreadable target boards → mirror renders
    // empty for those, mirroring how unreadable linked-item names stay null above.
    // Two bounded queries; no N+1 / per-cell fetch.
    const cols = columnsRes.data ?? [];
    const mirrorCols = cols.filter((c) => c.kind === "mirror");
    let mirrorTargetCells: CellValue[] = [];
    let mirrorTargetColumns: Pick<Column, "id" | "kind" | "settings">[] = [];
    if (mirrorCols.length > 0) {
      const targetColumnIds = [
        ...new Set(
          mirrorCols
            .map(
              (c) =>
                (c.settings as { target_column_id?: string })?.target_column_id,
            )
            .filter((x): x is string => Boolean(x)),
        ),
      ];
      const sourceRelIds = new Set(
        mirrorCols
          .map(
            (c) =>
              (c.settings as { source_relation_column_id?: string })
                ?.source_relation_column_id,
          )
          .filter((x): x is string => Boolean(x)),
      );
      const linkedItemIds = [
        ...new Set(
          rawLinks
            .filter((l) => sourceRelIds.has(l.column_id))
            .map((l) => l.linked_item_id),
        ),
      ];
      if (targetColumnIds.length > 0 && linkedItemIds.length > 0) {
        const [cellsRes2, colsRes2] = await Promise.all([
          // RLS-scoped, bounded over the (item_id, column_id) index.
          supabase
            .from("cell_values")
            .select("*")
            .in("item_id", linkedItemIds)
            .in("column_id", targetColumnIds)
            .limit(4000),
          supabase
            .from("columns")
            .select("id, kind, settings")
            .in("id", targetColumnIds),
        ]);
        if (cellsRes2.error)
          throw new Error(
            `Failed to load board mirror cells: ${cellsRes2.error.message}`,
          );
        if (colsRes2.error)
          throw new Error(
            `Failed to load board mirror columns: ${colsRes2.error.message}`,
          );
        mirrorTargetCells = cellsRes2.data ?? [];
        mirrorTargetColumns = colsRes2.data ?? [];
      }
    }

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
      relationLinks,
      mirrorTargetCells,
      mirrorTargetColumns,
    };
  },
);

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
