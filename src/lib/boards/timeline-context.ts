import { z } from "zod";
import type { CacheCellValue, CacheItem } from "@/lib/boards/cache";
import {
  isSyntheticDateSource,
  resolveTimelineSpan,
  syntheticDateCellValues,
  type TimelineSpan,
} from "@/lib/boards/dates";
import {
  resolveBoardSchedule,
  type BoardSchedule,
  type TimelineViewConfig,
} from "@/lib/boards/schedule";

const uuid = z.string().uuid();

export const timelineBoardSchema = z.object({
  id: uuid,
  name: z.string(),
  can_edit: z.boolean(),
  date_columns: z.array(z.object({ id: uuid, name: z.string() })),
  timeline_config: z.record(z.string(), z.unknown()).nullable(),
  groups: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      color: z.string(),
      position: z.number(),
    }),
  ),
});

export const timelineItemSchema = z.object({
  id: uuid,
  board_id: uuid,
  group_id: uuid,
  parent_id: uuid.nullable(),
  name: z.string(),
  position: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  dates: z.record(z.string(), z.unknown()),
});

export const dependencyContextSchema = z.object({
  boards: z.array(timelineBoardSchema),
  items: z.array(timelineItemSchema),
});

export const folderTimelineSchema = dependencyContextSchema.extend({
  board_order: z.array(uuid),
  external_item_ids: z.array(uuid),
  dependencies: z.array(
    z.object({ id: uuid, predecessor_id: uuid, successor_id: uuid }),
  ),
  total_items: z.number().int(),
  truncated: z.boolean(),
});

export type TimelineBoard = z.infer<typeof timelineBoardSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type DependencyContext = z.infer<typeof dependencyContextSchema>;
export type FolderTimelineData = z.infer<typeof folderTimelineSchema>;

export function boardScheduleOf(board: TimelineBoard): BoardSchedule {
  return resolveBoardSchedule(
    board.date_columns,
    board.timeline_config as TimelineViewConfig,
  );
}

/** Date cells of context items in the board-cache cell shape the date helpers read. */
export function contextCellValues(
  items: readonly TimelineItem[],
): CacheCellValue[] {
  return items.flatMap((it) =>
    Object.entries(it.dates).map(
      ([columnId, value]) =>
        ({
          item_id: it.id,
          column_id: columnId,
          board_id: it.board_id,
          org_id: "",
          updated_at: "",
          value,
        }) as CacheCellValue,
    ),
  );
}

export function spanOfContextItem(
  item: TimelineItem,
  board: TimelineBoard,
): TimelineSpan | null {
  const s = boardScheduleOf(board);
  if (!s.startSourceId) return null;
  const synthetic = [s.startSourceId, s.endSourceId].filter(
    (id): id is string => isSyntheticDateSource(id),
  );
  const cells = [
    ...contextCellValues([item]),
    ...(synthetic.length
      ? syntheticDateCellValues([item as unknown as CacheItem], synthetic)
      : []),
  ];
  return resolveTimelineSpan(item.id, cells, s.startSourceId, s.endSourceId);
}

export function contextSpans(
  ctx: DependencyContext,
): Map<string, TimelineSpan | null> {
  const boards = new Map(ctx.boards.map((b) => [b.id, b]));
  const out = new Map<string, TimelineSpan | null>();
  for (const it of ctx.items) {
    const b = boards.get(it.board_id);
    out.set(it.id, b ? spanOfContextItem(it, b) : null);
  }
  return out;
}
