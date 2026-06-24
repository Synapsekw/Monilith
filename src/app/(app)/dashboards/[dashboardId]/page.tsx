import { notFound } from "next/navigation";

import { DashboardCanvas } from "@/components/dashboards/DashboardCanvas";
import type { BoardOption } from "@/components/dashboards/WidgetConfigForm";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getDashboardPayload } from "@/lib/dashboards/queries";
import { optionSchema } from "@/lib/validations/boards";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ dashboardId: string }>;
}) {
  const { dashboardId } = await params;
  await requireUser();

  const payload = await getDashboardPayload(dashboardId);
  if (!payload) notFound();

  // Source-board options for the Add-widget dialog: workspace boards + their
  // columns. The columns read is filtered by the board's workspace via an inner
  // embed (columns_board_id_fkey) so it no longer waterfalls on the boards query
  // — both run in parallel. Boards with zero columns still appear (boards query).
  const supabase = await createClient();
  const [{ data: boardRows }, { data: allCols }] = await Promise.all([
    supabase
      .from("boards")
      .select("id, name")
      .eq("workspace_id", payload.dashboard.workspace_id)
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

  return <DashboardCanvas initialData={payload} boards={boards} />;
}
