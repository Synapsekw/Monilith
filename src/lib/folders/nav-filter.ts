import type { FolderNavData } from "./types";

/**
 * The folders one user may see out of an org-wide list: all of them for a
 * regular member, only the ones they are a member of for a guest. Every caller
 * of the org-cached `listFoldersCached` passes its result through this (or
 * through `filterFolderNav`, which also narrows placements).
 */
export function visibleFolders<T extends { id: string }>(
  folders: T[],
  opts: { isGuest: boolean; memberFolderIds: ReadonlySet<string> },
): T[] {
  return opts.isGuest
    ? folders.filter((f) => opts.memberFolderIds.has(f.id))
    : folders;
}

/**
 * What one user may see of a workspace's folders. `listFoldersCached` is cached
 * per org on the service client, so it returns every folder and every
 * placement; this narrows it per user:
 *  - a guest sees only folders they are a member of;
 *  - nobody receives the placement of a board they cannot read (those ids used
 *    to reach the page payload).
 */
export function filterFolderNav(
  data: FolderNavData,
  opts: {
    isGuest: boolean;
    memberFolderIds: ReadonlySet<string>;
    readableBoardIds: ReadonlySet<string>;
  },
): FolderNavData {
  const folders = visibleFolders(data.folders, opts);
  const visible = new Set(folders.map((f) => f.id));
  return {
    folders,
    placements: data.placements.filter(
      (p) => visible.has(p.folderId) && opts.readableBoardIds.has(p.boardId),
    ),
  };
}
