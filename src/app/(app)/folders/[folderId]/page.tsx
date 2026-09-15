import { notFound } from "next/navigation";
import { CommandCenter } from "@/components/folders/CommandCenter";
import { YourWidgets } from "@/components/folders/YourWidgets";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { buildFolderPayload } from "@/lib/folders/payload";
import {
  listFolderDashboards,
  listUnfiledDashboards,
} from "@/lib/folders/queries";
import { buildBoardOptions } from "@/lib/dashboards/board-options";
import { folderIdSchema } from "@/lib/validations/folders";

/**
 * The folder command center (spec §4). One RSC render; every in-page
 * interaction is client state + history.replaceState (working agreement #5).
 * `searchParams` is deliberately NOT awaited here: tab/stage/board are read on
 * the client from useSearchParams(), so a bare link and a deep link render the
 * same server payload.
 */
export default async function FolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
  if (!folderIdSchema.safeParse(folderId).success) notFound();
  const user = await requireUser();
  const supabase = await createClient();
  const payload = await buildFolderPayload(supabase, folderId, user.id);
  if (!payload) notFound();

  // Wave C (ruling #2): the strip's own reads, run after the payload wave on
  // the request's RLS client, bounded (listFolderDashboards caps at 10; the
  // boards/columns reads are scoped to the folder's workspace). Widget DATA
  // itself is unrelated — it loads lazily below the fold through the existing
  // batched getWidgetsData inside DashboardCanvasLazy.
  const [dashboards, unfiled, { data: boardRows }, { data: allCols }] =
    await Promise.all([
      listFolderDashboards(supabase, folderId),
      listUnfiledDashboards(supabase, payload.folder.workspaceId),
      supabase
        .from("boards")
        .select("id, name")
        .eq("workspace_id", payload.folder.workspaceId)
        .is("archived_at", null)
        .order("position", { ascending: true }),
      supabase
        .from("columns")
        .select(
          "id, name, kind, settings, board_id, boards!inner(workspace_id)",
        )
        .eq("boards.workspace_id", payload.folder.workspaceId)
        .order("position", { ascending: true }),
    ]);
  const boardOptions = buildBoardOptions(boardRows ?? [], allCols ?? []);

  return (
    <CommandCenter
      payload={payload}
      widgets={
        <YourWidgets
          folderId={folderId}
          workspaceId={payload.folder.workspaceId}
          dashboards={dashboards}
          boards={boardOptions}
          unfiled={unfiled}
        />
      }
    />
  );
}
