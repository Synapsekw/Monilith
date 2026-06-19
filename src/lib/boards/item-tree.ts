import type { CacheItem } from "@/lib/boards/cache";

export type ItemTree = {
  topLevel: CacheItem[];
  childrenByParent: Map<string, CacheItem[]>;
};

/**
 * Split items into top-level (`parent_id == null`) and children grouped by
 * parent id. Each list is sorted by `position` (cache mutations don't preserve
 * order, so we sort here rather than relying on the server query). Pure.
 */
export function bucketItems(items: readonly CacheItem[]): ItemTree {
  const byPos = (a: CacheItem, b: CacheItem) => a.position - b.position;
  const topLevel: CacheItem[] = [];
  const childrenByParent = new Map<string, CacheItem[]>();
  for (const it of items) {
    if (it.parent_id == null) {
      topLevel.push(it);
    } else {
      const arr = childrenByParent.get(it.parent_id);
      if (arr) arr.push(it);
      else childrenByParent.set(it.parent_id, [it]);
    }
  }
  topLevel.sort(byPos);
  for (const arr of childrenByParent.values()) arr.sort(byPos);
  return { topLevel, childrenByParent };
}
