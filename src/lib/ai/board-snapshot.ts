import { optionSchema } from "@/lib/validations/boards";

type RawColumn = { id: string; name: string; kind: string; settings: unknown };
type RawGroup = { id: string; name: string };
type RawItem = { id: string };
type RawCell = { item_id: string; column_id: string; value: unknown };

/** A board's sections, id + name only — the ids the AI write loop needs to
 *  name a destination group, with none of the rows that live in them. */
export type SnapshotGroup = { id: string; name: string };

export type SnapshotColumn = {
  id: string;
  name: string;
  kind: string;
  options?: { id: string; label: string }[];
};

export type ColumnStats = {
  fillRate: number; // 0..1 of items with a non-empty cell
  distinctCount: number;
  distribution?: { label: string; count: number }[]; // status/dropdown (top 12)
  numeric?: { min: number; max: number; avg: number; sum: number };
  dateRange?: { earliest: string; latest: string };
};

export type BoardSnapshot = {
  board: { id: string; name: string };
  rowCount: number;
  groups: SnapshotGroup[];
  columns: SnapshotColumn[];
  columnStats: Record<string, ColumnStats>;
  meta: { rowCount: number; columnCount: number; estimatedTokens: number };
};

function isFilled(kind: string, v: unknown): boolean {
  const o = (v ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "status":
      return o.optionId != null;
    case "dropdown":
      return Array.isArray(o.optionIds) && o.optionIds.length > 0;
    case "people":
      return Array.isArray(o.userIds) && o.userIds.length > 0;
    case "date":
      return typeof o.date === "string" && o.date.length > 0;
    case "numbers":
    case "percent":
    case "rating":
      return typeof o.n === "number" && Number.isFinite(o.n);
    case "currency":
      return typeof o.amount === "number" && Number.isFinite(o.amount);
    case "checkbox":
      return o.checked === true;
    case "text":
    case "link":
    case "email":
    case "phone":
      return typeof o.text === "string" && o.text.trim().length > 0;
    default:
      return v != null;
  }
}

export function buildBoardSnapshot(input: {
  board: { id: string; name: string };
  /** Board order preserved as given (getBoardPayload orders by position). */
  groups: RawGroup[];
  columns: RawColumn[];
  items: RawItem[];
  cellValues: RawCell[];
}): BoardSnapshot {
  const { board, groups, columns, items, cellValues } = input;
  const rowCount = items.length;

  // index cells by column
  const byColumn = new Map<string, RawCell[]>();
  for (const c of cellValues) {
    const arr = byColumn.get(c.column_id) ?? [];
    arr.push(c);
    byColumn.set(c.column_id, arr);
  }

  const snapColumns: SnapshotColumn[] = [];
  const columnStats: Record<string, ColumnStats> = {};

  for (const col of columns) {
    const opts =
      optionSchema
        .array()
        .safeParse((col.settings as { options?: unknown })?.options ?? [])
        .data ?? [];
    const labelById = new Map(opts.map((o) => [o.id, o.label]));
    snapColumns.push({
      id: col.id,
      name: col.name,
      kind: col.kind,
      ...(opts.length
        ? { options: opts.map((o) => ({ id: o.id, label: o.label })) }
        : {}),
    });

    const cells = (byColumn.get(col.id) ?? []).filter((c) =>
      isFilled(col.kind, c.value),
    );
    const filled = cells.length;
    const stats: ColumnStats = {
      fillRate: rowCount === 0 ? 0 : filled / rowCount,
      distinctCount: 0,
    };

    if (col.kind === "status" || col.kind === "dropdown") {
      const counts = new Map<string, number>();
      for (const c of cells) {
        const o = c.value as { optionId?: string; optionIds?: string[] };
        const ids = col.kind === "status" ? [o.optionId!] : (o.optionIds ?? []);
        for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      stats.distinctCount = counts.size;
      stats.distribution = [...counts.entries()]
        .map(([id, count]) => ({
          label: labelById.get(id) ?? "Unknown",
          count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12);
    } else if (
      col.kind === "numbers" ||
      col.kind === "percent" ||
      col.kind === "rating" ||
      col.kind === "currency"
    ) {
      const ns = cells.map((c) =>
        col.kind === "currency"
          ? (c.value as { amount: number }).amount
          : (c.value as { n: number }).n,
      );
      if (ns.length) {
        const sum = ns.reduce((a, b) => a + b, 0);
        stats.numeric = {
          min: Math.min(...ns),
          max: Math.max(...ns),
          avg: sum / ns.length,
          sum,
        };
        stats.distinctCount = new Set(ns).size;
      }
    } else if (col.kind === "date") {
      const ds = cells
        .map((c) => (c.value as { date: string }).date)
        .filter(Boolean)
        .sort();
      stats.distinctCount = new Set(ds).size;
      if (ds.length)
        stats.dateRange = { earliest: ds[0], latest: ds[ds.length - 1] };
    } else if (col.kind === "people") {
      const ids = new Set<string>();
      for (const c of cells)
        for (const u of (c.value as { userIds: string[] }).userIds) ids.add(u);
      stats.distinctCount = ids.size;
    }

    columnStats[col.id] = stats;
  }

  const snapshot: Omit<BoardSnapshot, "meta"> = {
    board: { id: board.id, name: board.name },
    rowCount,
    // Names and ids only — the payload stays bounded by group COUNT, and no
    // per-item scan is needed to build it.
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    columns: snapColumns,
    columnStats,
  };
  const estimatedTokens = Math.ceil(JSON.stringify(snapshot).length / 4);

  return {
    ...snapshot,
    meta: { rowCount, columnCount: columns.length, estimatedTokens },
  };
}
