import type { BoardCache, CacheColumn } from "@/lib/boards/cache";
import { buildCellMap, cellKey } from "@/lib/boards/cache";
import {
  firstStatusColumn,
  isOverdue,
  isStatusValueComplete,
  localTodayISO,
} from "@/lib/boards/overdue";
import { parseColumnOptions } from "@/lib/boards/column-options";
import {
  BLOCKED_LABEL,
  SIGNAL_ORDER,
  SIGNAL_TONE,
  STALL_DAYS,
} from "./constants";
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

/**
 * blocked — items whose FIRST-status-column option label matches
 * BLOCKED_LABEL and that have at least one successor in `dependencies`.
 * `itemIds` = each blocker plus everything downstream of it (transitive
 * successors), so the chip shows the whole chain. count = blockers.
 */
function blockedSignals(ctx: Ctx): Signal[] {
  const statusCol = ctx.statusColumn;
  if (!statusCol || ctx.input.dependencies.length === 0) return [];
  const blockedOptionIds = new Set(
    parseColumnOptions(statusCol.settings)
      .filter((o) => BLOCKED_LABEL.test(o.label))
      .map((o) => o.id),
  );
  if (blockedOptionIds.size === 0) return [];

  const successors = new Map<string, string[]>();
  for (const d of ctx.input.dependencies) {
    const list = successors.get(d.predecessor_id);
    if (list) list.push(d.successor_id);
    else successors.set(d.predecessor_id, [d.successor_id]);
  }

  const itemIds: string[] = [];
  const seen = new Set<string>();
  let blockers = 0;
  for (const it of ctx.input.items) {
    const v = ctx.cellMap.get(cellKey(it.id, statusCol.id));
    const optionId =
      typeof v === "object" && v !== null
        ? (v as { optionId?: unknown }).optionId
        : undefined;
    if (typeof optionId !== "string" || !blockedOptionIds.has(optionId))
      continue;
    if (!successors.has(it.id)) continue;
    blockers += 1;
    const stack = [it.id];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      itemIds.push(id);
      for (const next of successors.get(id) ?? []) stack.push(next);
    }
  }
  const s = signal("blocked", itemIds, "blocked chain");
  s.count = blockers;
  return [s];
}

/**
 * stalled — a group with ≥1 open item whose most recent activity across ALL
 * its items (open or done) is strictly older than STALL_DAYS. `itemIds` are
 * the group's open items (the work that went quiet); `groupIds` lets the
 * table keep those groups expanded.
 */
function stalledSignals(ctx: Ctx): Signal[] {
  const threshold = ctx.opts.now.getTime() - STALL_DAYS * DAY;
  const latestByGroup = new Map<string, number>();
  const openByGroup = new Map<string, string[]>();
  for (const it of ctx.input.items) {
    const t = ctx.lastActivity.get(it.id) ?? 0;
    if (t > (latestByGroup.get(it.group_id) ?? -1))
      latestByGroup.set(it.group_id, t);
    if (ctx.isOpen(it.id)) {
      const list = openByGroup.get(it.group_id);
      if (list) list.push(it.id);
      else openByGroup.set(it.group_id, [it.id]);
    }
  }
  const groupIds: string[] = [];
  const itemIds: string[] = [];
  for (const g of ctx.input.groups) {
    const open = openByGroup.get(g.id);
    if (!open || open.length === 0) continue;
    const latest = latestByGroup.get(g.id);
    if (latest === undefined || latest >= threshold) continue;
    groupIds.push(g.id);
    itemIds.push(...open);
  }
  const s = signal(
    "stalled",
    itemIds,
    groupIds.length === 1 ? "stalled group" : "stalled groups",
  );
  s.count = groupIds.length;
  s.groupIds = groupIds;
  return [s];
}

const KIND_BUILDERS: Record<SignalKind, (ctx: Ctx) => Signal[]> = {
  overdue: overdueSignals,
  blocked: blockedSignals,
  overloaded: () => [],
  stalled: stalledSignals,
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
