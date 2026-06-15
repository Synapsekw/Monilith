import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

export type Board = Tables<"boards">;
export type Group = Tables<"groups">;
export type Item = Tables<"items">;
export type Column = Tables<"columns">;
export type CellValue = Tables<"cell_values">;

export type BoardPayload = {
  board: Board;
  groups: Group[];
  columns: Column[];
  items: Item[];
  cellValues: CellValue[];
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
 * visible (RLS) or does not exist. Five parallel RLS-scoped reads — no joins,
 * no N+1.
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

  const [groupsRes, columnsRes, itemsRes, cellsRes] = await Promise.all([
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
  ]);

  return {
    board,
    groups: groupsRes.data ?? [],
    columns: columnsRes.data ?? [],
    items: itemsRes.data ?? [],
    cellValues: cellsRes.data ?? [],
  };
}
