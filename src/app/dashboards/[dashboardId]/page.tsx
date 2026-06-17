import { notFound } from "next/navigation";

import { DashboardCanvas } from "@/components/dashboards/DashboardCanvas";
import type { BoardOption } from "@/components/dashboards/AddWidgetDialog";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getDashboardPayload } from "@/lib/dashboards/queries";

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
  // numbers columns.
  const supabase = await createClient();
  const { data: boardRows } = await supabase
    .from("boards")
    .select("id, name")
    .eq("workspace_id", payload.dashboard.workspace_id)
    .order("position", { ascending: true });
  const { data: numberCols } = await supabase
    .from("columns")
    .select("id, name, board_id")
    .eq("kind", "numbers");

  const boards: BoardOption[] = (boardRows ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    numbersColumns: (numberCols ?? [])
      .filter((c) => c.board_id === b.id)
      .map((c) => ({ id: c.id, name: c.name })),
  }));

  return <DashboardCanvas initialData={payload} boards={boards} />;
}
