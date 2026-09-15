import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CommandCenter } from "@/components/folders/CommandCenter";
import { YourWidgets } from "@/components/folders/YourWidgets";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { buildFolderPayload } from "@/lib/folders/payload";
import {
  listFolderDashboards,
  listUnfiledDashboards,
} from "@/lib/folders/queries";
import { buildBoardOptions } from "@/lib/dashboards/board-options";
import type { BoardOption } from "@/components/dashboards/WidgetConfigForm";
import { folderIdSchema } from "@/lib/validations/folders";

/**
 * Bounds on the Add-widget dialog's option reads. They are workspace-wide (the
 * dialog can point a widget at any board in the workspace), so they need an
 * explicit ceiling — a big workspace would otherwise stream an unbounded
 * `select *` over every column it owns.
 */
const WIDGET_DIALOG_BOARDS_LIMIT = 100;
const WIDGET_DIALOG_COLUMNS_LIMIT = 2000;

/**
 * Wave C (spec §6): the widgets strip's own reads. They are NOT on the
 * first-byte path — this whole subtree renders inside a `<Suspense>` boundary
 * below, so waves A/B (the command-center payload) paint while these are still
 * in flight.
 *
 * The board/column options exist only to feed the Add-widget dialog inside a
 * `DashboardCanvasLazy`, and the attach picker's dropdown. With no dashboard
 * on the folder and nothing unfiled to attach there is no canvas and no
 * picker, so the two workspace-wide reads are skipped entirely; attaching or
 * creating one re-renders this page (`router.refresh()`), which runs them.
 */
async function WidgetsStrip({
  folderId,
  workspaceId,
}: {
  folderId: string;
  workspaceId: string;
}) {
  const supabase = await createClient();
  const [dashboards, unfiled] = await Promise.all([
    listFolderDashboards(supabase, folderId),
    listUnfiledDashboards(supabase, workspaceId),
  ]);

  let boardOptions: BoardOption[] = [];
  if (dashboards.length > 0 || unfiled.length > 0) {
    const [{ data: boardRows }, { data: allCols }] = await Promise.all([
      supabase
        .from("boards")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .is("archived_at", null)
        .order("position", { ascending: true })
        .limit(WIDGET_DIALOG_BOARDS_LIMIT),
      supabase
        .from("columns")
        .select(
          "id, name, kind, settings, board_id, boards!inner(workspace_id)",
        )
        .eq("boards.workspace_id", workspaceId)
        .order("position", { ascending: true })
        .limit(WIDGET_DIALOG_COLUMNS_LIMIT),
    ]);
    boardOptions = buildBoardOptions(boardRows ?? [], allCols ?? []);
  }

  return (
    <YourWidgets
      folderId={folderId}
      workspaceId={workspaceId}
      dashboards={dashboards}
      boards={boardOptions}
      unfiled={unfiled}
    />
  );
}

/** Streaming placeholder for the strip — it sits below the fold. */
function WidgetsStripSkeleton() {
  return (
    <div className="flex flex-col gap-3" data-print-hide>
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/**
 * The folder command center (spec §4). One RSC render; every in-page
 * interaction is client state + history.replaceState (working agreement #5).
 * `searchParams` is deliberately NOT awaited here: tab/stage/board are read on
 * the client from useSearchParams(), so a bare link and a deep link render the
 * same server payload.
 *
 * Only waves A/B block the first byte. Wave C (the widgets strip) streams in
 * behind a Suspense boundary — it used to be awaited in the page body, so the
 * whole page waited on an unbounded workspace-wide column read before anything
 * rendered.
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

  return (
    <CommandCenter
      payload={payload}
      widgets={
        <Suspense fallback={<WidgetsStripSkeleton />}>
          <WidgetsStrip
            folderId={folderId}
            workspaceId={payload.folder.workspaceId}
          />
        </Suspense>
      }
    />
  );
}
