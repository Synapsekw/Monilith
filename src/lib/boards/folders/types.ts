/**
 * Shared shapes for the sidebar's private board-folder layer. Pure types, no I/O
 * — reads (`queries-cached.ts`), the fold (`group.ts`) and the actions all import
 * from here, which is what lets those three be built in parallel.
 */

/** A folder as rendered in the nav. Private to one user; never org-visible. */
export type BoardFolder = {
  id: string;
  name: string;
  position: number;
};

/** One board's placement in one folder, for one user. */
export type BoardFolderPlacement = {
  boardId: string;
  folderId: string;
  position: number;
};

/** Everything the nav needs about folders, in one read. */
export type BoardFolderData = {
  folders: BoardFolder[];
  placements: BoardFolderPlacement[];
};
