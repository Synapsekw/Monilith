/**
 * Shared shapes for the sidebar's private board-folder layer. Pure types, no I/O
 * — reads (`queries-cached.ts`), the fold (`group.ts`) and the actions all import
 * from here, which is what lets those three be built in parallel.
 */

/**
 * The message a folder mutation returns when RLS filtered the row out — the
 * folder is not yours, or another tab already deleted it. Lives here rather than
 * in `actions.ts` because a `"use server"` module may only export async
 * functions, and the CLIENT needs to recognise this one outcome: for a DELETE it
 * is not a failure to report but the goal already met, so the dialog closes and
 * refreshes instead of dead-ending on Cancel.
 */
export const FOLDER_GONE_ERROR = "That folder no longer exists.";

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
