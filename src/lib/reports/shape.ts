import type { BoardPayload, Column, Group, Item } from "@/lib/boards/queries";
import type { ColumnKind } from "@/lib/validations/boards";
import { cellToText } from "@/lib/boards/spreadsheet/cell-codec";

export type ReportRow = {
  item: Item;
  cells: Map<string, string>;
  subitems: ReportRow[];
};
export type ReportGroup = { group: Group; rows: ReportRow[] };
export type ReportModel = { columns: Column[]; groups: ReportGroup[] };

export type Kpis = {
  itemCount: number;
  percentComplete: number; // 0..100, rounded
  overdueCount: number;
  statusTally: { label: string; count: number }[];
};

const DONE_LABELS = new Set(["done", "complete", "completed", "closed"]);

function cellLookup(payload: BoardPayload): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const cv of payload.cellValues)
    map.set(`${cv.item_id}:${cv.column_id}`, cv.value);
  return map;
}

function firstStatusColumn(columns: Column[]): Column | undefined {
  return columns.find((c) => c.kind === "status");
}

function isDone(
  payload: BoardPayload,
  itemId: string,
  statusCol: Column | undefined,
): boolean {
  if (!statusCol) return false;
  const lookup = cellLookup(payload);
  const raw = lookup.get(`${itemId}:${statusCol.id}`);
  const label = cellToText(
    statusCol.kind as ColumnKind,
    raw,
    statusCol.settings,
  )
    .trim()
    .toLowerCase();
  return DONE_LABELS.has(label);
}

export function shapeReport(
  payload: BoardPayload,
  peopleNames: Map<string, string>,
): ReportModel {
  const lookup = cellLookup(payload);
  const columns = [...payload.columns].sort((a, b) => a.position - b.position);
  const resolvePerson = (id: string) => peopleNames.get(id) ?? null;

  const buildRow = (item: Item): ReportRow => {
    const cells = new Map<string, string>();
    for (const col of columns) {
      const raw = lookup.get(`${item.id}:${col.id}`);
      cells.set(
        col.id,
        cellToText(col.kind as ColumnKind, raw, col.settings, resolvePerson),
      );
    }
    const subitems = payload.items
      .filter((c) => c.parent_id === item.id)
      .sort((a, b) => a.position - b.position)
      .map(buildRow);
    return { item, cells, subitems };
  };

  const groups = [...payload.groups]
    .sort((a, b) => a.position - b.position)
    .map((group) => ({
      group,
      rows: payload.items
        .filter((i) => i.group_id === group.id && i.parent_id === null)
        .sort((a, b) => a.position - b.position)
        .map(buildRow),
    }));

  return { columns, groups };
}

export function computeKpis(
  payload: BoardPayload,
  peopleNames: Map<string, string>,
): Kpis {
  const topLevel = payload.items.filter((i) => i.parent_id === null);
  const statusCol = firstStatusColumn(payload.columns);
  const doneCount = topLevel.filter((i) =>
    isDone(payload, i.id, statusCol),
  ).length;

  const tally = new Map<string, number>();
  if (statusCol) {
    const lookup = cellLookup(payload);
    for (const i of topLevel) {
      const label =
        cellToText(
          statusCol.kind as ColumnKind,
          lookup.get(`${i.id}:${statusCol.id}`),
          statusCol.settings,
          (id) => peopleNames.get(id) ?? null,
        ).trim() || "—";
      tally.set(label, (tally.get(label) ?? 0) + 1);
    }
  }

  const dateCol = payload.columns.find((c) => c.kind === "date");
  let overdue = 0;
  if (dateCol) {
    const lookup = cellLookup(payload);
    const today = new Date().toISOString().slice(0, 10);
    for (const i of topLevel) {
      const v = lookup.get(`${i.id}:${dateCol.id}`);
      const iso = typeof v === "string" ? v.slice(0, 10) : "";
      if (iso && iso < today && !isDone(payload, i.id, statusCol)) overdue += 1;
    }
  }

  return {
    itemCount: topLevel.length,
    percentComplete: topLevel.length
      ? Math.round((doneCount / topLevel.length) * 100)
      : 0,
    overdueCount: overdue,
    statusTally: [...tally.entries()].map(([label, count]) => ({
      label,
      count,
    })),
  };
}

export type GroupSummary = {
  group: Group;
  count: number;
  percentComplete: number;
};

export function computeGroupSummaries(payload: BoardPayload): GroupSummary[] {
  const statusCol = firstStatusColumn(payload.columns);
  return [...payload.groups]
    .sort((a, b) => a.position - b.position)
    .map((group) => {
      const rows = payload.items.filter(
        (i) => i.group_id === group.id && i.parent_id === null,
      );
      const done = rows.filter((i) => isDone(payload, i.id, statusCol)).length;
      return {
        group,
        count: rows.length,
        percentComplete: rows.length
          ? Math.round((done / rows.length) * 100)
          : 0,
      };
    });
}
