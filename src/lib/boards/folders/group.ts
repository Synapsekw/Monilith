import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";
import type { BoardFolder, BoardFolderPlacement } from "./types";

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
  /** Only folders with at least one currently-visible board. */
  folders: Array<{ folder: BoardFolder; boards: NavBoard[] }>;
  unfiledOwned: BoardListEntry[];
  unfiledShared: SharedBoardEntry[];
};

/**
 * Folds folders + placements + the two board lists into the sidebar tree.
 *
 * Two rules live here and nowhere else:
 *   1. A folder with no visible board is DROPPED, not rendered empty. Folders
 *      are user-global while owned boards are workspace-filtered, so a folder
 *      whose boards all live in another workspace must simply not appear.
 *   2. A placement is only honoured if BOTH its board and its folder are
 *      present — a stale placement (revoked share, deleted folder) is inert.
 */
export function groupBoardsByFolder({
  folders,
  placements,
  boards,
  sharedBoards,
}: {
  folders: BoardFolder[];
  placements: BoardFolderPlacement[];
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
    folders: ordered
      .filter((f) => (buckets.get(f.id)?.length ?? 0) > 0)
      .map((folder) => ({
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
