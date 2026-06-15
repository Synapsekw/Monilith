import type {
  CacheCellValue,
  CacheColumn,
  CacheItem,
} from "@/lib/boards/cache";
import type { ColumnOption } from "@/lib/validations/boards";

export const NO_STATUS_ID = "__no_status__";

export type KanbanColumn = {
  /** Option id, or NO_STATUS_ID for the unset bucket. */
  id: string;
  label: string;
  /** Pill color; null for the No-status column. */
  color: string | null;
  /** The status option id to write when a card is dropped here (null = clear). */
  optionId: string | null;
  cards: CacheItem[];
};

type Slices = { items: CacheItem[]; cellValues: CacheCellValue[] };

/** Group items into Kanban columns by a status column. Pure. Items stay in the
 * order given (the payload/cache is already position-sorted). */
export function buildKanbanColumns(
  { items, cellValues }: Slices,
  groupColumn: CacheColumn,
): KanbanColumn[] {
  const options =
    (groupColumn.settings as { options?: ColumnOption[] })?.options ?? [];
  const validIds = new Set(options.map((o) => o.id));

  // item_id → optionId for this column.
  const statusByItem = new Map<string, string | null>();
  for (const c of cellValues) {
    if (c.column_id !== groupColumn.id) continue;
    const optionId =
      (c.value as { optionId?: string | null })?.optionId ?? null;
    statusByItem.set(c.item_id, optionId);
  }

  const buckets = new Map<string, CacheItem[]>();
  buckets.set(NO_STATUS_ID, []);
  for (const o of options) buckets.set(o.id, []);

  for (const item of items) {
    const optionId = statusByItem.get(item.id) ?? null;
    const key = optionId && validIds.has(optionId) ? optionId : NO_STATUS_ID;
    buckets.get(key)!.push(item);
  }

  return [
    {
      id: NO_STATUS_ID,
      label: "No status",
      color: null,
      optionId: null,
      cards: buckets.get(NO_STATUS_ID)!,
    },
    ...options.map((o) => ({
      id: o.id,
      label: o.label,
      color: o.color,
      optionId: o.id,
      cards: buckets.get(o.id)!,
    })),
  ];
}
