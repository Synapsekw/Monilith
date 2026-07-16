import { getUser } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/org/active";
import { listMyBoardsCached } from "@/lib/boards/queries-cached";
import { listDashboardsCached } from "@/lib/dashboards/queries-cached";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { CommandPalette } from "@/components/command-palette";

/**
 * Streamed data for the ⌘K command palette (board/dashboard/workspace
 * navigation + create targets). Behind its own <Suspense fallback={null}> — the
 * palette is hidden until invoked, so a null fallback is correct. Identity is
 * read OUTSIDE any cache, then passed into the `use cache` reads (Phase 9.3).
 */
export async function CommandPaletteData() {
  const [user, orgId] = await Promise.all([getUser(), getActiveOrgId()]);
  const userId = user?.id ?? "";
  const [boards, dashboards, workspaces] = await Promise.all([
    listMyBoardsCached(userId),
    listDashboardsCached(orgId),
    listWorkspacesCached(orgId),
  ]);

  return (
    <CommandPalette
      boards={boards}
      dashboards={dashboards.map((d) => ({ id: d.id, name: d.name }))}
      workspaces={workspaces}
    />
  );
}
