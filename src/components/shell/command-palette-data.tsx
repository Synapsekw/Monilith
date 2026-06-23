import { listMyBoards } from "@/lib/boards/queries";
import { listDashboards } from "@/lib/dashboards/queries";
import { createClient } from "@/lib/supabase/server";
import { CommandPalette } from "@/components/command-palette";

/**
 * Streamed data for the ⌘K command palette (board/dashboard/workspace
 * navigation + create targets). Behind its own <Suspense fallback={null}> — the
 * palette is hidden until invoked, so a null fallback is correct. Not cached
 * (cookie-bound reads → caching is Phase 9.3).
 */
export async function CommandPaletteData() {
  const supabase = await createClient();
  const [boards, dashboards, { data: workspaces }] = await Promise.all([
    listMyBoards(),
    listDashboards(),
    supabase.from("workspaces").select("id, name"),
  ]);

  return (
    <CommandPalette
      boards={boards}
      dashboards={dashboards.map((d) => ({ id: d.id, name: d.name }))}
      workspaces={workspaces ?? []}
    />
  );
}
