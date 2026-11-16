import { getUser } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/org/active";
import { listMyBoardsCached } from "@/lib/boards/queries-cached";
import { listFoldersCached } from "@/lib/folders/queries-cached";
import { getFolderAccessForUserCached } from "@/lib/folders/access-cached";
import { visibleFolders } from "@/lib/folders/nav-filter";
import { listVisibleWorkspaces } from "@/lib/org/visible-roster";
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
  // Narrowed for a guest: only workspaces holding something shared with them.
  const workspaces = await listVisibleWorkspaces(orgId);
  const workspaceId = await getActiveWorkspaceId(workspaces);
  const [boards, nav, folderAccess] = await Promise.all([
    listMyBoardsCached(userId),
    listFoldersCached(orgId, workspaceId),
    getFolderAccessForUserCached(userId, orgId),
  ]);

  return (
    <CommandPalette
      boards={boards}
      folders={visibleFolders(nav?.folders ?? [], {
        isGuest: folderAccess.isGuest,
        memberFolderIds: new Set(folderAccess.folderIds),
      }).map((f) => ({ id: f.id, name: f.name }))}
      workspaces={workspaces}
      // From the folder-access read above: no extra query.
      isGuest={folderAccess.isGuest}
    />
  );
}
