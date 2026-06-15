import type { BoardView, Column } from "@/lib/boards/queries";

/** Pick the selected view: requested id → first table view → first view → null. */
export function resolveSelectedView(
  views: BoardView[],
  requestedId: string | undefined,
): BoardView | null {
  if (views.length === 0) return null;
  if (requestedId) {
    const found = views.find((v) => v.id === requestedId);
    if (found) return found;
  }
  return views.find((v) => v.kind === "table") ?? views[0];
}

/** Resolve the Kanban grouping column from config, falling back to the first status column. */
export function resolveKanbanGroupColumn(
  columns: Column[],
  config: { group_column_id?: string | null } | null | undefined,
): Column | null {
  const statusColumns = columns.filter((c) => c.kind === "status");
  const requested = config?.group_column_id
    ? statusColumns.find((c) => c.id === config.group_column_id)
    : undefined;
  return requested ?? statusColumns[0] ?? null;
}
