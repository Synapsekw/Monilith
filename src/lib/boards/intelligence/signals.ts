import type { BoardCache, CacheColumn } from "@/lib/boards/cache";
import { buildCellMap, cellKey } from "@/lib/boards/cache";
import {
  firstStatusColumn,
  isOverdue,
  isStatusValueComplete,
  localTodayISO,
} from "@/lib/boards/overdue";
import { SIGNAL_ORDER, SIGNAL_TONE } from "./constants";
import type { Signal, SignalKind } from "./types";

/**
 * Deterministic board signals, computed client-side from the payload already
 * in memory (spec §3). Pure and synchronous: no clock reads, no DB — `now` and
 * `lastSeenAt` are inputs so the result is reproducible in tests and reusable
 * by the Phase-2 server run.
 */
export type SignalsInput = Pick<
  BoardCache,
  "items" | "columns" | "cellValues" | "groups" | "dependencies"
>;

export type SignalsOptions = {
  now: Date;
  /** The caller's last visit (board_visits.last_seen_at), or null on a first visit. */
  lastSeenAt: Date | null;
  currentUserId: string;
  /** userId → display name, for "overloaded · Ana". Unknown ids read "someone". */
  memberNames?: ReadonlyMap<string, string>;
};

const DAY = 86_400_000;

/** Everything the per-kind builders share, derived once per call. */
type Ctx = {
  input: SignalsInput;
  opts: SignalsOptions;
  cellMap: Map<string, unknown>;
  statusColumn: CacheColumn | null;
  todayISO: string;
  /** itemId → ms of its latest activity (item.updated_at or any cell's updated_at). */
  lastActivity: Map<string, number>;
  isOpen: (itemId: string) => boolean;
};

function parseMs(iso: unknown): number {
  if (typeof iso !== "string") return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * items.updated_at is NOT bumped by cell edits (no such trigger exists in
 * supabase/migrations), so "last activity" folds in every cell's updated_at.
 */
function buildLastActivity(input: SignalsInput): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of input.items) map.set(it.id, parseMs(it.updated_at));
  for (const cv of input.cellValues) {
    const t = parseMs(cv.updated_at);
    const cur = map.get(cv.item_id);
    if (cur !== undefined && t > cur) map.set(cv.item_id, t);
  }
  return map;
}

function buildContext(input: SignalsInput, opts: SignalsOptions): Ctx {
  const cellMap = buildCellMap(input.cellValues);
  const statusColumn = firstStatusColumn(input.columns);
  const isOpen = (itemId: string) =>
    !isStatusValueComplete(
      statusColumn
        ? (cellMap.get(cellKey(itemId, statusColumn.id)) ?? null)
        : null,
      statusColumn,
    );
  return {
    input,
    opts,
    cellMap,
    statusColumn,
    todayISO: localTodayISO(opts.now),
    lastActivity: buildLastActivity(input),
    isOpen,
  };
}

function signal(kind: SignalKind, itemIds: string[], label: string): Signal {
  return {
    kind,
    count: itemIds.length,
    label,
    tone: SIGNAL_TONE[kind],
    itemIds,
  };
}

/**
 * overdue — open items with any date cell before today (viewer-local), the
 * same rule the date cell's tint uses (`isOverdue` + first-status-column
 * completeness; `ItemRow.tsx`).
 */
function overdueSignals(ctx: Ctx): Signal[] {
  const dateColumns = ctx.input.columns.filter((c) => c.kind === "date");
  if (dateColumns.length === 0) return [];
  const itemIds: string[] = [];
  for (const it of ctx.input.items) {
    if (!ctx.isOpen(it.id)) continue;
    const late = dateColumns.some((col) =>
      isOverdue(ctx.cellMap.get(cellKey(it.id, col.id)), ctx.todayISO),
    );
    if (late) itemIds.push(it.id);
  }
  return [signal("overdue", itemIds, "overdue")];
}

const KIND_BUILDERS: Record<SignalKind, (ctx: Ctx) => Signal[]> = {
  overdue: overdueSignals,
  blocked: () => [],
  overloaded: () => [],
  stalled: () => [],
  changed: () => [],
};

/** All signals with a non-zero count, in strip order. Not truncated. */
export function computeSignals(
  input: SignalsInput,
  opts: SignalsOptions,
): Signal[] {
  const ctx = buildContext(input, opts);
  const out: Signal[] = [];
  for (const kind of SIGNAL_ORDER) {
    for (const s of KIND_BUILDERS[kind](ctx)) if (s.count > 0) out.push(s);
  }
  return out;
}

export { DAY as SIGNALS_DAY_MS };
