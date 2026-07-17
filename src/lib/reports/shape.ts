import type { BoardPayload, Column, Group, Item } from "@/lib/boards/queries";
import type { ColumnKind } from "@/lib/validations/boards";
import { cellToText } from "@/lib/boards/spreadsheet/cell-codec";

/** A shaped cell: display text plus, for option-bearing kinds
 *  (status/dropdown/priority), the selected option's raw hex so blocks can
 *  render a colored pill. `color` is undefined for plain cells. */
export type ReportCell = { text: string; color?: string };
export type ReportRow = {
  item: Item;
  cells: Map<string, ReportCell>;
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

/** The selected option's hex for a colored-option cell (status/dropdown/
 *  priority), or undefined. Tolerates the `{optionId}` / `{optionIds:[]}` /
 *  bare-string value shapes the board stores. */
function optionColor(
  kind: ColumnKind,
  raw: unknown,
  settings: unknown,
): string | undefined {
  if (kind !== "status" && kind !== "dropdown" && kind !== "priority") return;
  const options = (settings as { options?: { id: string; color?: string }[] })
    ?.options;
  if (!options?.length) return;
  let id: string | undefined;
  if (typeof raw === "string") id = raw;
  else if (raw && typeof raw === "object") {
    const o = raw as { optionId?: string; optionIds?: string[] };
    id = o.optionId ?? o.optionIds?.[0];
  }
  if (!id) return;
  return options.find((op) => op.id === id)?.color ?? undefined;
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
    const cells = new Map<string, ReportCell>();
    for (const col of columns) {
      const raw = lookup.get(`${item.id}:${col.id}`);
      const kind = col.kind as ColumnKind;
      cells.set(col.id, {
        text: cellToText(kind, raw, col.settings, resolvePerson),
        color: optionColor(kind, raw, col.settings),
      });
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

/** Ids of items that have at least one child (header/parent rows). */
function parentIdSet(payload: BoardPayload): Set<string> {
  const s = new Set<string>();
  for (const i of payload.items) if (i.parent_id) s.add(i.parent_id);
  return s;
}

/** Leaf items — those with no subitems. KPIs and progress count leaves (the
 *  trackable work units) so header/parent rows, which often carry no status,
 *  don't dilute completion. On a flat board every item is a leaf, so behavior
 *  is unchanged; on a board where work lives in subitems, the subitems drive
 *  the numbers. */
function leafItems(payload: BoardPayload): Item[] {
  const parents = parentIdSet(payload);
  return payload.items.filter((i) => !parents.has(i.id));
}

export function computeKpis(
  payload: BoardPayload,
  peopleNames: Map<string, string>,
): Kpis {
  const leaves = leafItems(payload);
  const statusCol = firstStatusColumn(payload.columns);
  const doneCount = leaves.filter((i) =>
    isDone(payload, i.id, statusCol),
  ).length;

  const tally = new Map<string, number>();
  if (statusCol) {
    const lookup = cellLookup(payload);
    for (const i of leaves) {
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
    for (const i of leaves) {
      const v = lookup.get(`${i.id}:${dateCol.id}`);
      const iso = typeof v === "string" ? v.slice(0, 10) : "";
      if (iso && iso < today && !isDone(payload, i.id, statusCol)) overdue += 1;
    }
  }

  return {
    itemCount: leaves.length,
    percentComplete: leaves.length
      ? Math.round((doneCount / leaves.length) * 100)
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
  const parents = parentIdSet(payload);
  return [...payload.groups]
    .sort((a, b) => a.position - b.position)
    .map((group) => {
      // Leaf items in this group (subitems carry a group_id too), so progress
      // reflects the actual work, not just the header rows.
      const leaves = payload.items.filter(
        (i) => i.group_id === group.id && !parents.has(i.id),
      );
      const done = leaves.filter((i) =>
        isDone(payload, i.id, statusCol),
      ).length;
      return {
        group,
        count: leaves.length,
        percentComplete: leaves.length
          ? Math.round((done / leaves.length) * 100)
          : 0,
      };
    });
}
