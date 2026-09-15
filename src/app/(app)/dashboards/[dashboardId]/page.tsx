import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { DashboardCanvasLazy } from "@/components/dashboards/DashboardCanvasLazy";
import { AiReviewBanner } from "@/components/dashboards/ai/AiReviewBanner";
import type { BoardOption } from "@/components/dashboards/WidgetConfigForm";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getDashboardPayload } from "@/lib/dashboards/queries";
import { dashboardRedirectTarget } from "@/lib/folders/redirect";
import { optionSchema } from "@/lib/validations/boards";

/**
 * `?review=1` is the AI-generation review flow's own flag (Keep / Regenerate
 * / Discard, `AiReviewBanner`) — the one query param this page reads. Parsed
 * once and reused for both gates below: it keeps the folder redirect from
 * swallowing the banner, and replaces the old raw string comparison.
 */
const dashboardSearchParamsSchema = z.object({
  review: z.literal("1").optional(),
});

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ dashboardId: string }>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { dashboardId } = await params;
  // safeParse, not parse: a garbage/unexpected `review` value (e.g. an array
  // from a repeated query param) must fall through to "review not requested"
  // rather than 500 the whole dashboard page.
  const parsedSp = dashboardSearchParamsSchema.safeParse(await searchParams);
  const reviewRequested = parsedSp.success && parsedSp.data.review === "1";
  await requireUser();

  const payload = await getDashboardPayload(dashboardId);
  if (!payload) notFound();

  const supabase = await createClient();

  // Spec §4: a dashboard with a live folder lives on that folder's Overview.
  // The folder FK is `on delete set null`, so folder_id being set almost
  // always means the folder exists — the read still guards RLS-hidden
  // folders (spec §8). `error` is intentionally unread: on RLS-hidden or any
  // other failure `data` comes back `null` just like a real 404, so both
  // collapse to the same "treat the folder as gone, fall back to the legacy
  // canvas" outcome (ruling 3) without branching on the error code (42501 vs
  // a genuine miss).
  //
  // `reviewRequested` is the carve-out: Task 13's AI wizard sets `folder_id`
  // at creation time and still pushes to `/dashboards/{id}?review=1`, so the
  // Keep/Regenerate/Discard banner must render on the legacy canvas instead
  // of being redirected away before the user ever sees it.
  if (payload.dashboard.folder_id) {
    const { data: folder } = await supabase
      .from("folders")
      .select("id")
      .eq("id", payload.dashboard.folder_id)
      .maybeSingle();
    const target = dashboardRedirectTarget(
      payload.dashboard,
      folder !== null,
      reviewRequested,
    );
    if (target) redirect(target);
  }

  // Source-board options for the Add-widget dialog: workspace boards + their
  // columns. The columns read is filtered by the board's workspace via an inner
  // embed (columns_board_id_fkey) so it no longer waterfalls on the boards query
  // — both run in parallel. Boards with zero columns still appear (boards query).
  const [{ data: boardRows }, { data: allCols }] = await Promise.all([
    supabase
      .from("boards")
      .select("id, name")
      .eq("workspace_id", payload.dashboard.workspace_id)
      .is("archived_at", null)
      .order("position", { ascending: true }),
    supabase
      .from("columns")
      .select("id, name, kind, settings, board_id, boards!inner(workspace_id)")
      .eq("boards.workspace_id", payload.dashboard.workspace_id)
      .order("position", { ascending: true }),
  ]);

  const boards: BoardOption[] = (boardRows ?? []).map((b) => {
    const cols = (allCols ?? []).filter((c) => c.board_id === b.id);
    return {
      id: b.id,
      name: b.name,
      numbersColumns: cols
        .filter((c) => c.kind === "numbers")
        .map((c) => ({ id: c.id, name: c.name })),
      statusColumns: cols
        .filter((c) => c.kind === "status")
        .map((c) => ({ id: c.id, name: c.name })),
      dateColumns: cols
        .filter((c) => c.kind === "date")
        .map((c) => ({ id: c.id, name: c.name })),
      peopleColumns: cols
        .filter((c) => c.kind === "people")
        .map((c) => ({ id: c.id, name: c.name })),
      dropdownColumns: cols
        .filter((c) => c.kind === "dropdown")
        .map((c) => ({ id: c.id, name: c.name })),
      percentColumns: cols
        .filter((c) => c.kind === "percent")
        .map((c) => ({ id: c.id, name: c.name })),
      allColumns: cols.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        options:
          optionSchema
            .array()
            .safeParse((c.settings as { options?: unknown }).options ?? [])
            .data ?? [],
      })),
    };
  });

  return (
    <>
      {reviewRequested && (
        <div className="px-4 pt-4">
          <AiReviewBanner dashboardId={dashboardId} />
        </div>
      )}
      <DashboardCanvasLazy initialData={payload} boards={boards} />
    </>
  );
}
