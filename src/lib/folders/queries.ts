import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestBoardIntelligenceRun } from "@/lib/ai/board-intelligence/runs";
import type { Database, Tables } from "@/types/database.types";
import type { FolderBoardRef, FolderSummary, IntelligenceBrief } from "./types";

type DB = SupabaseClient<Database>;
export type FolderHead = { folder: FolderSummary; boards: FolderBoardRef[] };

/** Spec §6 bound: ≤ 100 boards per folder. */
const FOLDER_BOARDS_LIMIT = 100;
/** Folded-in dashboards rendered on the Overview strip. */
const FOLDER_DASHBOARDS_LIMIT = 10;
/** Unfiled-dashboards read: the "Unfiled" gallery section and the attach picker. */
const UNFILED_DASHBOARDS_LIMIT = 100;

/** Folder + its live boards. Two reads in one Promise.all; null when RLS hides the folder. */
export async function getFolderHead(
  supabase: DB,
  folderId: string,
): Promise<FolderHead | null> {
  const [folderRes, boardsRes] = await Promise.all([
    supabase
      .from("folders")
      .select("id, name, workspace_id, org_id, position")
      .eq("id", folderId)
      .maybeSingle(),
    supabase
      .from("folder_boards")
      .select("position, boards!inner(id, name, archived_at)")
      .eq("folder_id", folderId)
      .is("boards.archived_at", null)
      .order("position", { ascending: true })
      .limit(FOLDER_BOARDS_LIMIT),
  ]);
  if (folderRes.error)
    throw new Error(`Failed to load folder: ${folderRes.error.message}`);
  if (!folderRes.data) return null;
  if (boardsRes.error)
    throw new Error(`Failed to load folder boards: ${boardsRes.error.message}`);
  const f = folderRes.data;
  return {
    folder: {
      id: f.id,
      name: f.name,
      workspaceId: f.workspace_id,
      orgId: f.org_id,
      position: f.position,
    },
    boards: (boardsRes.data ?? []).map((row) => ({
      id: row.boards.id,
      name: row.boards.name,
      position: row.position,
    })),
  };
}

/**
 * The latest Board Intelligence brief per board for THIS user (runs are
 * own-rows-only by RLS). One indexed `LIMIT 1` per board via the canonical
 * `getLatestBoardIntelligenceRun` helper, fanned out with `Promise.all` over
 * the folder's boards (bounded to `FOLDER_BOARDS_LIMIT` by the caller) —
 * NOT a single wide scan across every board's runs: a board with many
 * regenerations used to starve the LIMIT budget for the rest of the folder.
 */
export async function listLatestBriefs(
  supabase: DB,
  boards: FolderBoardRef[],
  userId: string,
): Promise<IntelligenceBrief[]> {
  if (boards.length === 0) return [];
  const runs = await Promise.all(
    boards.map((b) => getLatestBoardIntelligenceRun(supabase, b.id, userId)),
  );
  const nameOf = new Map(boards.map((b) => [b.id, b.name]));
  const out: IntelligenceBrief[] = [];
  for (const run of runs) {
    if (!run) continue;
    out.push({
      boardId: run.boardId,
      boardName: nameOf.get(run.boardId) ?? "",
      brief: run.payload.brief,
      generatedAt: run.generatedAt,
    });
  }
  return out.sort((a, b) => a.boardName.localeCompare(b.boardName));
}

/** Folded-in dashboards with their widget rows, oldest first (resolved ambiguity #5). */
export async function listFolderDashboards(
  supabase: DB,
  folderId: string,
): Promise<
  { dashboard: Tables<"dashboards">; widgets: Tables<"dashboard_widgets">[] }[]
> {
  const { data, error } = await supabase
    .from("dashboards")
    .select("*, dashboard_widgets(*)")
    .eq("folder_id", folderId)
    .order("created_at", { ascending: true })
    .limit(FOLDER_DASHBOARDS_LIMIT);
  if (error)
    throw new Error(`Failed to load folder dashboards: ${error.message}`);
  return (data ?? []).map(({ dashboard_widgets, ...dashboard }) => ({
    dashboard,
    widgets: [...dashboard_widgets].sort((a, b) => a.position - b.position),
  }));
}

/** Dashboards in the workspace with no folder — the "Unfiled" gallery section and the attach picker. */
export async function listUnfiledDashboards(
  supabase: DB,
  workspaceId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("dashboards")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("folder_id", null)
    .order("name", { ascending: true })
    .limit(UNFILED_DASHBOARDS_LIMIT);
  if (error)
    throw new Error(`Failed to load unfiled dashboards: ${error.message}`);
  return data ?? [];
}
