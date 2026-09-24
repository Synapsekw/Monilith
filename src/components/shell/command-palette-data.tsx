import { getUser } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/org/active";
import { listMyBoardsCached } from "@/lib/boards/queries-cached";
import { listFoldersCached } from "@/lib/folders/queries-cached";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { getActiveWorkspaceId } from "@/lib/workspaces/active";
import { CommandPalette } from "@/components/command-palette";

/**
 * Streamed data for the ⌘K command palette (board/folder/workspace
 * navigation + create targets). Behind its own <Suspense fallback={null}> — the
 * palette is hidden until invoked, so a null fallback is correct. Identity is
 * read OUTSIDE any cache, then passed into the `use cache` reads (Phase 9.3).
 */
export async function CommandPaletteData() {
  const [user, orgId] = await Promise.all([getUser(), getActiveOrgId()]);
  const userId = user?.id ?? "";
  const workspaces = await listWorkspacesCached(orgId);
  const workspaceId = await getActiveWorkspaceId(workspaces);
  const [boards, nav] = await Promise.all([
    listMyBoardsCached(userId),
    listFoldersCached(orgId, workspaceId),
  ]);

  return (
    <CommandPalette
      boards={boards}
      folders={(nav?.folders ?? []).map((f) => ({ id: f.id, name: f.name }))}
      workspaces={workspaces}
    />
  );
}
