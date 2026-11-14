import { higherAccess } from "@/lib/boards/folder-levels";
import type { SharedBoardEntry } from "@/lib/boards/queries";

/**
 * One "Shared with me" list out of boards granted directly and boards reached
 * through a folder. A board appears once, at the higher level (the same
 * higher-of rule the board page uses); direct grants keep their order and
 * folder-only boards follow.
 */
export function mergeSharedBoards(
  direct: SharedBoardEntry[],
  viaFolder: SharedBoardEntry[],
): SharedBoardEntry[] {
  const byId = new Map<string, SharedBoardEntry>();
  for (const b of [...direct, ...viaFolder]) {
    const existing = byId.get(b.id);
    if (!existing) {
      byId.set(b.id, b);
      continue;
    }
    const level = higherAccess(existing.access_level, b.access_level);
    if (level && level !== existing.access_level) {
      byId.set(b.id, { ...existing, access_level: level });
    }
  }
  return [...byId.values()];
}
