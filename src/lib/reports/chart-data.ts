import type { BoardPayload, Column } from "@/lib/boards/queries";
import type { ColumnKind } from "@/lib/validations/boards";
import type { ChartBlockOptions } from "@/lib/reports/config";
import { leafItems } from "@/lib/reports/shape";
import { PRINT_NEUTRAL, rampSlot } from "@/lib/reports/chart-palette";

/** One chart category. `color` is already resolved — components never pick colors. */
export type ChartCategory = {
  /** Stable identity: option id | group id | user id | "__none" | "__other". */
  key: string;
  label: string;
  value: number;
  color: string;
};

export type ChartSeries = {
  /** Sorted value desc, then label asc. Length <= options.maxCategories. */
  categories: ChartCategory[];
  /**
   * Leaf items counted, INCLUDING those folded into "Other". For a multi-value
   * column an item can appear in more than one category, so
   * sum(categories) >= total by design.
   */
  total: number;
  /** Human name of the category axis, for the derived block title. */
  categoryName: string;
  empty: boolean;
};

const EMPTY: ChartSeries = {
  categories: [],
  total: 0,
  categoryName: "",
  empty: true,
};

/** Column kinds a chart can group by. Used by the builder's picker too. */
export const CHARTABLE_KINDS = [
  "status",
  "dropdown",
  "priority",
  "people",
] as const;

export function isChartableColumn(c: Column): boolean {
  return (CHARTABLE_KINDS as readonly string[]).includes(c.kind);
}

/** A bucket before counting: identity, label, optional board color, stable order. */
type Bucket = { key: string; label: string; color?: string; order: number };

function userIdsOf(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const ids = (raw as { userIds?: unknown }).userIds;
  return Array.isArray(ids)
    ? ids.filter((v): v is string => typeof v === "string")
    : [];
}

function columnBuckets(
  col: Column,
  names: Map<string, string>,
  payload: BoardPayload,
): Bucket[] {
  if (col.kind === "people") {
    // People have no settings order, so use resolved-name order — a property of
    // the directory, not of the chart's value ranking.
    const ids = new Set<string>();
    for (const cv of payload.cellValues) {
      if (cv.column_id !== col.id) continue;
      for (const id of userIdsOf(cv.value)) ids.add(id);
    }
    return [...ids]
      .map((id) => ({ id, label: names.get(id) ?? "" }))
      .filter((p) => p.label !== "")
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((p, i) => ({ key: p.id, label: p.label, order: i }));
  }
  const settings = col.settings as {
    options?: { id: string; label: string; color?: string }[];
  } | null;
  return (settings?.options ?? []).map((o, i) => ({
    key: o.id,
    label: o.label,
    color: o.color ?? undefined,
    order: i,
  }));
}

/** The option ids a cell selects — one for status/priority, many for dropdown. */
function optionIdsOf(kind: ColumnKind, raw: unknown): string[] {
  if (kind === "people") return userIdsOf(raw);
  if (typeof raw === "string") return [raw];
  if (!raw || typeof raw !== "object") return [];
  const v = raw as { optionId?: unknown; optionIds?: unknown };
  if (typeof v.optionId === "string") return [v.optionId];
  if (Array.isArray(v.optionIds)) {
    return v.optionIds.filter((x): x is string => typeof x === "string");
  }
  return [];
}

function resolveColumn(
  payload: BoardPayload,
  options: ChartBlockOptions,
): Column | null {
  if (options.source === "status") {
    return payload.columns.find((c) => c.kind === "status") ?? null;
  }
  if (options.source === "column") {
    const col = payload.columns.find((c) => c.id === options.columnId) ?? null;
    return col && isChartableColumn(col) ? col : null;
  }
  return null;
}

/**
 * Assign a color to every bucket: the board's own option/group color when it has
 * one, otherwise the next print-ramp slot walked in BUCKET ORDER (settings index
 * / group position / name order) — never in value order, so a data change that
 * reorders the chart does not repaint the survivors.
 */
function paint(buckets: Bucket[]): Map<string, string> {
  const out = new Map<string, string>();
  let slot = 0;
  for (const b of [...buckets].sort((a, b2) => a.order - b2.order)) {
    out.set(b.key, b.color ?? rampSlot(slot++));
  }
  return out;
}

export function computeChartSeries(
  payload: BoardPayload,
  peopleNames: Map<string, string>,
  options: ChartBlockOptions,
): ChartSeries {
  const leaves = leafItems(payload);
  if (leaves.length === 0) return EMPTY;

  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);

  let buckets: Bucket[];
  let categoryName: string;

  if (options.source === "board_group") {
    categoryName = "Group";
    buckets = [...payload.groups]
      .sort((a, b) => a.position - b.position)
      .map((g, i) => ({
        key: g.id,
        label: g.name,
        color: g.color ?? undefined,
        order: i,
      }));
    for (const it of leaves) bump(it.group_id);
  } else {
    const col = resolveColumn(payload, options);
    if (!col) return EMPTY;
    categoryName = col.name;
    buckets = columnBuckets(col, peopleNames, payload);
    const byItem = new Map<string, unknown>();
    for (const cv of payload.cellValues) {
      if (cv.column_id === col.id) byItem.set(cv.item_id, cv.value);
    }
    for (const it of leaves) {
      const ids = optionIdsOf(col.kind as ColumnKind, byItem.get(it.id));
      const known = ids.filter((id) => buckets.some((b) => b.key === id));
      if (known.length === 0) bump("__none");
      else for (const id of known) bump(id);
    }
  }

  const colors = paint(buckets);
  const labels = new Map(buckets.map((b) => [b.key, b.label]));

  let categories: ChartCategory[] = [...counts.entries()]
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({
      key,
      label: key === "__none" ? "—" : (labels.get(key) ?? "—"),
      value,
      color:
        key === "__none" ? PRINT_NEUTRAL : (colors.get(key) ?? PRINT_NEUTRAL),
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  if (categories.length === 0) return EMPTY;

  if (categories.length > options.maxCategories) {
    const keep = categories.slice(0, options.maxCategories - 1);
    const rest = categories.slice(options.maxCategories - 1);
    keep.push({
      key: "__other",
      label: "Other",
      value: rest.reduce((n, c) => n + c.value, 0),
      color: PRINT_NEUTRAL,
    });
    categories = keep;
  }

  return { categories, total: leaves.length, categoryName, empty: false };
}
