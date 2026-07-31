import type {
  BoardCache,
  CacheColumn,
  CacheCellValue,
} from "@/lib/boards/cache";

export type MirrorValue = {
  linkedItemId: string;
  /** null when the target cell is unreadable (RLS) or unset. */
  value: CacheCellValue["value"] | null;
};

type MirrorSettings = {
  source_relation_column_id?: string;
  target_column_id?: string;
};

/** Derive mirrored values for one mirror cell: the target column's value on each
 *  item linked through the source relation column, in link position order. A
 *  linked item whose target cell the caller cannot read (RLS) contributes null
 *  (rendered empty), exactly as 6d-1 nulls an unreadable linked-item name. Pure. */
export function mirrorValuesForCell(
  cache: BoardCache,
  itemId: string,
  mirrorColumn: Pick<CacheColumn, "settings">,
): MirrorValue[] {
  const s = (mirrorColumn.settings ?? {}) as MirrorSettings;
  if (!s.source_relation_column_id || !s.target_column_id) return [];
  const links = cache.relationLinks
    .filter(
      (l) => l.itemId === itemId && l.columnId === s.source_relation_column_id,
    )
    .sort((a, b) => a.position - b.position);
  return links.map((l) => {
    const cell = cache.mirrorTargetCells.find(
      (c) => c.item_id === l.linkedItemId && c.column_id === s.target_column_id,
    );
    return { linkedItemId: l.linkedItemId, value: cell?.value ?? null };
  });
}

/** The referenced target column's render metadata (kind + settings), or null. */
export function mirrorTargetColumnFor(
  cache: BoardCache,
  mirrorColumn: Pick<CacheColumn, "settings">,
): Pick<CacheColumn, "id" | "kind" | "settings"> | null {
  const s = (mirrorColumn.settings ?? {}) as MirrorSettings;
  if (!s.target_column_id) return null;
  return (
    cache.mirrorTargetColumns.find((c) => c.id === s.target_column_id) ?? null
  );
}

/**
 * Flatten the mirrored target values across `itemIds` into a single array, for
 * column-summary footer aggregation (6d-3). Each link on each item contributes
 * its target cell value; a value the caller cannot read (RLS) or that is unset
 * contributes null (counted as empty by the aggregator). The result feeds
 * `aggregate(targetKind, ...)` where `targetKind` comes from
 * `mirrorTargetColumnFor`. Pure. */
export function mirrorFooterValues(
  cache: BoardCache,
  mirrorColumn: Pick<CacheColumn, "settings">,
  itemIds: readonly string[],
): (CacheCellValue["value"] | null)[] {
  const out: (CacheCellValue["value"] | null)[] = [];
  for (const id of itemIds) {
    for (const mv of mirrorValuesForCell(cache, id, mirrorColumn)) {
      out.push(mv.value);
    }
  }
  return out;
}
