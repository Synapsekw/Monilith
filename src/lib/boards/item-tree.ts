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

/**
 * Expand a list of item ids to include all of their descendants, depth-first
 * (each parent immediately followed by its children, in child order). Each id
 * is emitted at most once, and a malformed `parent_id` cycle can never loop
 * (a `seen` set guards it). Pure — this is the single source of truth for
 * "which rows a column summary counts" (top-level rows + their subitems).
 */
export function withSubitems(
  itemIds: readonly string[],
  childrenByParent: ReadonlyMap<string, readonly { id: string }[]>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    const children = childrenByParent.get(id);
    if (children) for (const c of children) visit(c.id);
  };
  for (const id of itemIds) visit(id);
  return out;
}
