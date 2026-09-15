import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";
import type { FolderPlacement, FolderSummary } from "./types";

/**
 * A board in the nav tree, tagged with which list it came from. Kept as a
 * discriminated union rather than a merged shape so each row renderer keeps its
 * own affordances: an owned board shows the "shared out" marker and the full
 * board menu; a shared board shows the viewer eye and "Shared by X".
 */
export type NavBoard =
  | { kind: "owned"; board: BoardListEntry }
  | { kind: "shared"; board: SharedBoardEntry };

export type GroupedNav = {
  /** Every folder in the workspace, in order — empty ones included. */
  folders: Array<{ folder: FolderSummary; boards: NavBoard[] }>;
  unfiledOwned: BoardListEntry[];
  unfiledShared: SharedBoardEntry[];
};

/**
 * Folds folders + placements + the two board lists into the sidebar tree.
 *
 * Two rules live here and nowhere else:
 *   1. An EMPTY folder is rendered, not dropped. This inverts the rule the
 *      private per-user layer had. A shared folder is a project with its own
 *      command center at /folders/<id>, and it is workspace-scoped like the
 *      boards beside it — so "no visible board" now means "this project has
 *      nothing filed yet", which the user must be able to see and open. (The
 *      old rule existed because private folders were user-GLOBAL: a folder
 *      whose boards all lived in another workspace would otherwise have shown
 *      up empty in every workspace.)
 *   2. A placement is only honoured if BOTH its board and its folder are
 *      present — a stale placement (revoked share, deleted folder) is inert.
 */
export function groupBoardsByFolder({
  folders,
  placements,
  boards,
  sharedBoards,
}: {
  folders: FolderSummary[];
  placements: FolderPlacement[];
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
}): GroupedNav {
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const placementByBoard = new Map(
    placements
      .filter((p) => folderById.has(p.folderId))
      .map((p) => [p.boardId, p]),
  );

  const buckets = new Map<string, Array<{ position: number; nav: NavBoard }>>();
  const unfiledOwned: BoardListEntry[] = [];
  const unfiledShared: SharedBoardEntry[] = [];

  const place = (nav: NavBoard, onUnfiled: () => void) => {
    const placement = placementByBoard.get(nav.board.id);
    if (!placement) {
      onUnfiled();
      return;
    }
    const bucket = buckets.get(placement.folderId) ?? [];
    bucket.push({ position: placement.position, nav });
    buckets.set(placement.folderId, bucket);
  };

  for (const board of boards) {
    place({ kind: "owned", board }, () => unfiledOwned.push(board));
  }
  for (const board of sharedBoards) {
    place({ kind: "shared", board }, () => unfiledShared.push(board));
  }

  const ordered = [...folders].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );

  return {
    folders: ordered.map((folder) => ({
      folder,
      boards: (buckets.get(folder.id) ?? [])
        .sort(
          (a, b) =>
            a.position - b.position ||
            a.nav.board.name.localeCompare(b.nav.board.name),
        )
        .map((entry) => entry.nav),
    })),
    unfiledOwned,
    unfiledShared,
  };
}
