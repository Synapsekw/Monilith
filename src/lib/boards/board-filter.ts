import {
  listFilterSchema,
  type FilterCondition,
  type FilterOperator,
  type ListFilter,
} from "@/lib/validations/dashboards";
import type { ColumnKind } from "@/lib/validations/boards";
import { cellKey } from "@/lib/boards/cache";

/**
 * Board-level filter / sort / quick-search state.
 *
 * This is **client state mirrored to the URL** (History API) — never a server
 * round-trip. It narrows/orders the already-loaded board cache in memory, so
 * applying a filter re-renders the view without re-running the board RSC page
 * (AGENTS.md §invariants / gotcha-09). The three quick facets (`q`, `people`,
 * `status`) sit alongside a generic condition set (`conditions`) that reuses the
 * dashboards {@link ListFilter} model + FilterBuilder UI.
 */

export type SortDirection = "asc" | "desc";

/** A sort target: the built-in Name / Created columns, or a real board column. */
export type SortField =
  | { kind: "name" }
  | { kind: "created" }
  | { kind: "column"; columnId: string };

export type BoardSort = { field: SortField; direction: SortDirection };

export type BoardFilterState = {
  /** Quick text search over item name + text-column contents. */
  q: string;
  /** People-column quick filter: user ids (OR — match any people cell). */
  people: string[];
  /** Status-column quick filter: option ids (OR — match any status cell). */
  status: string[];
  /** Generic condition builder (reuses the dashboards ListFilter model). */
  conditions: ListFilter;
  /** Active in-memory sort, or null to keep the board's own position order. */
  sort: BoardSort | null;
};

/** The empty / cleared state. */
export const EMPTY_BOARD_FILTER: BoardFilterState = {
  q: "",
  people: [],
  status: [],
  conditions: { combinator: "and", conditions: [] },
  sort: null,
};

// ── URL param names (kept distinct from the board's `view` / `item` params) ──
export const FILTER_PARAM_KEYS = [
  "q",
  "people",
  "status",
  "filter",
  "sort",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Parse / serialize (URL ⇄ state)
// ─────────────────────────────────────────────────────────────────────────────

function parseSort(raw: string | null): BoardSort | null {
  if (!raw) return null;
  const parts = raw.split(":");
  const dir: SortDirection =
    parts[parts.length - 1] === "desc" ? "desc" : "asc";
  if (parts[0] === "col" && parts[1]) {
    return { field: { kind: "column", columnId: parts[1] }, direction: dir };
  }
  if (parts[0] === "name") return { field: { kind: "name" }, direction: dir };
  if (parts[0] === "created") {
    return { field: { kind: "created" }, direction: dir };
  }
  return null;
}

function serializeSort(sort: BoardSort | null): string | null {
  if (!sort) return null;
  const head =
    sort.field.kind === "column"
      ? `col:${sort.field.columnId}`
      : sort.field.kind;
  return `${head}:${sort.direction}`;
}

function parseCsv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseConditions(raw: string | null): ListFilter {
  if (!raw) return { combinator: "and", conditions: [] };
  try {
    const parsed = listFilterSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // malformed URL — fall through to the empty filter (defensive parse)
  }
  return { combinator: "and", conditions: [] };
}

/** Read filter/sort/search state out of the URL search params. Total + safe. */
export function parseBoardFilter(
  params: Pick<URLSearchParams, "get">,
): BoardFilterState {
  return {
    q: params.get("q") ?? "",
    people: parseCsv(params.get("people")),
    status: parseCsv(params.get("status")),
    conditions: parseConditions(params.get("filter")),
    sort: parseSort(params.get("sort")),
  };
}

/**
 * Produce the param updates that encode `state`. Each key maps to its serialized
 * string, or `null` to delete it — the shape the History-API writer consumes so
 * cleared facets drop out of the URL.
 */
export function serializeBoardFilter(
  state: BoardFilterState,
): Record<(typeof FILTER_PARAM_KEYS)[number], string | null> {
  const q = state.q.trim();
  return {
    q: q === "" ? null : q,
    people: state.people.length ? state.people.join(",") : null,
    status: state.status.length ? state.status.join(",") : null,
    filter: state.conditions.conditions.length
      ? JSON.stringify(state.conditions)
      : null,
    sort: serializeSort(state.sort),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Active-state helpers (badges / clear-all gating)
// ─────────────────────────────────────────────────────────────────────────────

/** How many discrete filter facets are set (drives the "Filter" button badge). */
export function filterFacetCount(state: BoardFilterState): number {
  return (
    state.people.length +
    state.status.length +
    state.conditions.conditions.length
  );
}

/** True when ANY filter/sort/search is active (drives "Clear all" visibility). */
export function isFilterActive(state: BoardFilterState): boolean {
  return (
    state.q.trim() !== "" || filterFacetCount(state) > 0 || state.sort !== null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory predicate + comparator (the actual filtering / sorting)
// ─────────────────────────────────────────────────────────────────────────────

export type FilterColumnMeta = {
  id: string;
  kind: ColumnKind;
  settings: unknown;
};

export type FilterContext = {
  columns: readonly FilterColumnMeta[];
  /** `${item_id}:${column_id}` → raw cell value (the board's live cellMap). */
  cellMap: Map<string, unknown>;
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});

function optionOrder(settings: unknown): Map<string, number> {
  const opts = (rec(settings).options ?? []) as { id?: unknown }[];
  const map = new Map<string, number>();
  opts.forEach((o, i) => {
    if (typeof o.id === "string") map.set(o.id, i);
  });
  return map;
}

/** Whether a (kind, value) cell counts as empty — used by is_empty/not_empty. */
export function isCellEmpty(kind: ColumnKind, value: unknown): boolean {
  if (value == null) return true;
  const v = rec(value);
  switch (kind) {
    case "text":
      return String(v.text ?? "") === "";
    case "status":
      return v.optionId == null;
    case "dropdown":
      return !Array.isArray(v.optionIds) || v.optionIds.length === 0;
    case "people":
      return !Array.isArray(v.userIds) || v.userIds.length === 0;
    case "date":
      return !v.date;
    case "numbers":
      return typeof v.n !== "number";
    case "currency":
      return typeof v.amount !== "number";
    case "percent":
      return typeof v.percent !== "number";
    case "rating":
      return typeof v.rating !== "number";
    case "checkbox":
      return v.checked !== true;
    case "email":
      return !v.email;
    case "phone":
      return !v.phone;
    case "link":
      return !v.url;
    default:
      return false;
  }
}

/** Numeric sort key for a cell, or null when the cell has no orderable value. */
function numericKey(kind: ColumnKind, v: Rec): number | null {
  if (kind === "numbers" && typeof v.n === "number") return v.n;
  if (kind === "currency" && typeof v.amount === "number") return v.amount;
  if (kind === "percent" && typeof v.percent === "number") return v.percent;
  if (kind === "rating" && typeof v.rating === "number") return v.rating;
  return null;
}

/** Evaluate one generic condition against a single item's cell value. */
export function evaluateCondition(
  cond: FilterCondition,
  kind: ColumnKind,
  value: unknown,
): boolean {
  const op: FilterOperator = cond.operator;
  if (op === "is_empty") return isCellEmpty(kind, value);
  if (op === "not_empty") return !isCellEmpty(kind, value);

  const v = rec(value);
  switch (op) {
    case "is": // status option equality
      return v.optionId != null && v.optionId === cond.value;
    case "is_not":
      return v.optionId !== cond.value;
    case "contains": {
      const text = String(v.text ?? "").toLowerCase();
      return text.includes(String(cond.value ?? "").toLowerCase());
    }
    case "eq":
      return String(v.text ?? "") === String(cond.value ?? "");
    case "num_eq":
    case "num_ne":
    case "gt":
    case "lt": {
      const n = numericKey(kind, v);
      const target =
        typeof cond.value === "number" ? cond.value : Number(cond.value);
      if (n == null || Number.isNaN(target)) return false;
      if (op === "num_eq") return n === target;
      if (op === "num_ne") return n !== target;
      if (op === "gt") return n > target;
      return n < target;
    }
    case "before":
    case "after":
    case "on": {
      const date = typeof v.date === "string" ? v.date : "";
      const target = String(cond.value ?? "");
      if (!date || !target) return false;
      if (op === "before") return date < target;
      if (op === "after") return date > target;
      return date === target;
    }
    default:
      return false;
  }
}

type SearchableItem = { id: string; name: string; created_at: string };

/**
 * Build the in-memory predicate for the current filter state. Quick facets
 * (search / people / status) AND together with the generic condition set (whose
 * own combinator is and/or). An all-empty state yields a predicate that admits
 * everything.
 */
export function buildItemPredicate(
  state: BoardFilterState,
  ctx: FilterContext,
): (item: SearchableItem) => boolean {
  const q = state.q.trim().toLowerCase();
  const people = new Set(state.people);
  const status = new Set(state.status);
  const byId = new Map(ctx.columns.map((c) => [c.id, c]));

  const textColumns = ctx.columns.filter((c) => c.kind === "text");
  const peopleColumns = ctx.columns.filter((c) => c.kind === "people");
  const statusColumns = ctx.columns.filter((c) => c.kind === "status");
  const conditions = state.conditions.conditions;
  const combinator = state.conditions.combinator ?? "and";

  const get = (itemId: string, columnId: string) =>
    ctx.cellMap.get(cellKey(itemId, columnId));

  return (item) => {
    // 1) quick search — item name OR any text cell contains the query
    if (q) {
      let hit = item.name.toLowerCase().includes(q);
      if (!hit) {
        for (const col of textColumns) {
          const text = String(
            rec(get(item.id, col.id)).text ?? "",
          ).toLowerCase();
          if (text.includes(q)) {
            hit = true;
            break;
          }
        }
      }
      if (!hit) return false;
    }

    // 2) people quick filter — any people cell intersects the selected users
    if (people.size > 0) {
      let hit = false;
      for (const col of peopleColumns) {
        const ids = rec(get(item.id, col.id)).userIds;
        if (Array.isArray(ids) && ids.some((u) => people.has(String(u)))) {
          hit = true;
          break;
        }
      }
      if (!hit) return false;
    }

    // 3) status quick filter — any status cell equals a selected option
    if (status.size > 0) {
      let hit = false;
      for (const col of statusColumns) {
        const optionId = rec(get(item.id, col.id)).optionId;
        if (typeof optionId === "string" && status.has(optionId)) {
          hit = true;
          break;
        }
      }
      if (!hit) return false;
    }

    // 4) generic conditions (and/or)
    if (conditions.length > 0) {
      const results = conditions.map((cond) => {
        const col = byId.get(cond.columnId);
        if (!col) return false;
        return evaluateCondition(cond, col.kind, get(item.id, cond.columnId));
      });
      const pass =
        combinator === "or" ? results.some(Boolean) : results.every(Boolean);
      if (!pass) return false;
    }

    return true;
  };
}

/**
 * Build the comparator for the current sort, or null when no sort is active.
 * Empty cells always sort last (in both directions) — the least-surprising
 * behaviour for a mostly-sparse board.
 */
export function buildItemComparator(
  state: BoardFilterState,
  ctx: FilterContext,
): ((a: SearchableItem, b: SearchableItem) => number) | null {
  const sort = state.sort;
  if (!sort) return null;
  const factor = sort.direction === "desc" ? -1 : 1;

  if (sort.field.kind === "name") {
    return (a, b) => factor * a.name.localeCompare(b.name);
  }
  if (sort.field.kind === "created") {
    return (a, b) => factor * a.created_at.localeCompare(b.created_at);
  }

  const columnId = sort.field.columnId;
  const col = ctx.columns.find((c) => c.id === columnId);
  if (!col) return null;
  const kind = col.kind;
  const order =
    kind === "status" || kind === "dropdown" ? optionOrder(col.settings) : null;
  const get = (itemId: string) => ctx.cellMap.get(cellKey(itemId, columnId));

  const compareKey = (v: Rec): number | string | null => {
    switch (kind) {
      case "text":
        return v.text ? String(v.text) : null;
      case "email":
        return v.email ? String(v.email) : null;
      case "phone":
        return v.phone ? String(v.phone) : null;
      case "link":
        return v.url ? String(v.url) : null;
      case "date":
        return v.date ? String(v.date) : null;
      case "checkbox":
        return v.checked === true ? 1 : v.checked === false ? 0 : null;
      case "priority":
        return v.level === "critical" ? 1 : v.level === "normal" ? 0 : null;
      case "status":
      case "dropdown": {
        const id =
          kind === "status"
            ? v.optionId
            : Array.isArray(v.optionIds)
              ? v.optionIds[0]
              : undefined;
        if (typeof id !== "string") return null;
        return order?.get(id) ?? null;
      }
      case "people":
        return Array.isArray(v.userIds) && v.userIds.length
          ? v.userIds.length
          : null;
      default:
        return numericKey(kind, v);
    }
  };

  return (a, b) => {
    const ka = compareKey(rec(get(a.id)));
    const kb = compareKey(rec(get(b.id)));
    // Empty always last, regardless of direction.
    if (ka == null && kb == null) return 0;
    if (ka == null) return 1;
    if (kb == null) return -1;
    let cmp: number;
    if (typeof ka === "number" && typeof kb === "number") cmp = ka - kb;
    else cmp = String(ka).localeCompare(String(kb));
    return factor * cmp;
  };
}
