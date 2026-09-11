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
  EFFORT_COLUMN_NAME,
  MAX_CHIPS,
  OVERLOAD_RATIO,
  SIGNAL_ORDER,
  SIGNAL_TONE,
  STALL_DAYS,
} from "./constants";
import type { IntelSelection, Signal, SignalKind } from "./types";

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

  // `removeItem`/`removeGroup` in cache.ts prune items/cellValues but not
  // dependencies, so a stale edge can still point at an id no longer in
  // `items` — skip such ids while walking so a dangling edge never puts a
  // ghost id in `itemIds` (and never gets expanded further, since it has no
  // real successors of its own).
  const known = new Set(ctx.input.items.map((i) => i.id));

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
      if (!known.has(id)) continue;
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

function firstName(name: string | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : "someone";
}

function numberOf(v: unknown): number | null {
  const n =
    typeof v === "object" && v !== null ? (v as { n?: unknown }).n : undefined;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * overloaded — per person: open items assigned in any people column, weighted
 * by the effort/numbers column when the board has one, compared with the
 * median load across everyone who carries load. One signal per person over
 * OVERLOAD_RATIO × median, highest load first (the strip keeps the first).
 */
function overloadedSignals(ctx: Ctx): Signal[] {
  const peopleCols = ctx.input.columns.filter((c) => c.kind === "people");
  if (peopleCols.length === 0) return [];
  const effortCol =
    ctx.input.columns.find(
      (c) => c.kind === "numbers" && EFFORT_COLUMN_NAME.test(c.name),
    ) ?? null;

  const load = new Map<string, { total: number; itemIds: string[] }>();
  for (const it of ctx.input.items) {
    if (!ctx.isOpen(it.id)) continue;
    const weight = effortCol
      ? (numberOf(ctx.cellMap.get(cellKey(it.id, effortCol.id))) ?? 1)
      : 1;
    const assignees = new Set<string>();
    for (const col of peopleCols) {
      const v = ctx.cellMap.get(cellKey(it.id, col.id));
      const ids =
        typeof v === "object" && v !== null
          ? (v as { userIds?: unknown }).userIds
          : undefined;
      if (!Array.isArray(ids)) continue;
      for (const id of ids) if (typeof id === "string") assignees.add(id);
    }
    for (const uid of assignees) {
      const entry = load.get(uid) ?? { total: 0, itemIds: [] };
      entry.total += weight;
      entry.itemIds.push(it.id);
      load.set(uid, entry);
    }
  }
  if (load.size < 2) return [];

  const totals = [...load.values()].map((e) => e.total).sort((a, b) => a - b);
  const mid = totals.length / 2;
  const median =
    totals.length % 2 === 1
      ? totals[Math.floor(mid)]
      : (totals[mid - 1] + totals[mid]) / 2;
  if (median <= 0) return [];

  return [...load.entries()]
    .filter(([, e]) => e.total > OVERLOAD_RATIO * median)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([uid, e]) => {
      const s = signal(
        "overloaded",
        e.itemIds,
        `overloaded · ${firstName(ctx.opts.memberNames?.get(uid))}`,
      );
      s.subjectUserId = uid;
      return s;
    });
}

/** "2:05 PM" (same local day) · "Tue" (< 6 days) · "Sep 3" (older). */
export function formatSince(since: Date, now: Date): string {
  const sameDay =
    since.getFullYear() === now.getFullYear() &&
    since.getMonth() === now.getMonth() &&
    since.getDate() === now.getDate();
  if (sameDay)
    return since.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  if (now.getTime() - since.getTime() < 6 * DAY)
    return since.toLocaleDateString("en-US", { weekday: "short" });
  return since.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** changed — items with activity after the caller's last visit. Hidden on a first visit. */
function changedSignals(ctx: Ctx): Signal[] {
  const since = ctx.opts.lastSeenAt;
  if (!since) return [];
  const sinceMs = since.getTime();
  const itemIds = ctx.input.items
    .filter((it) => (ctx.lastActivity.get(it.id) ?? 0) > sinceMs)
    .map((it) => it.id);
  return [
    signal(
      "changed",
      itemIds,
      `changed since ${formatSince(since, ctx.opts.now)}`,
    ),
  ];
}

const KIND_BUILDERS: Record<SignalKind, (ctx: Ctx) => Signal[]> = {
  overdue: overdueSignals,
  blocked: blockedSignals,
  overloaded: overloadedSignals,
  stalled: stalledSignals,
  changed: changedSignals,
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

/** The chips the strip shows: the first MAX_CHIPS in strip order (spec §3.2). */
export function stripSignals(signals: Signal[]): Signal[] {
  return signals.slice(0, MAX_CHIPS);
}

/** The URL/selection form of a signal (`overloaded:u1`, `overdue`). */
export function signalSelection(s: Signal): IntelSelection {
  return s.subjectUserId
    ? { kind: s.kind, subject: s.subjectUserId }
    : { kind: s.kind };
}

export function selectionEquals(
  a: IntelSelection | null,
  b: IntelSelection | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && (a.subject ?? null) === (b.subject ?? null);
}

/** The signal the active chip points at, or null when none / no longer present. */
export function findActiveSignal(
  signals: Signal[],
  sel: IntelSelection | null,
): Signal | null {
  if (!sel) return null;
  return signals.find((s) => selectionEquals(signalSelection(s), sel)) ?? null;
}

/**
 * Narrow a view's item list to the active chip. `null` (no chip) returns the
 * SAME array so memoized derivations keep their identity. A matching sub-item
 * keeps its parent so it stays reachable in every view (table rows nest under
 * a parent; the timeline nests scheduled children under a header row).
 */
export function narrowItemsToSignal<
  T extends { id: string; parent_id: string | null },
>(items: T[], itemIds: ReadonlySet<string> | null): T[] {
  if (itemIds === null) return items;
  const parentsToKeep = new Set<string>();
  for (const it of items)
    if (itemIds.has(it.id) && it.parent_id) parentsToKeep.add(it.parent_id);
  return items.filter((it) => itemIds.has(it.id) || parentsToKeep.has(it.id));
}

/** ISO timestamp of the board's newest item/cell activity, or null when empty. */
export function latestActivityISO(input: SignalsInput): string | null {
  let best = 0;
  for (const t of buildLastActivity(input).values()) if (t > best) best = t;
  return best > 0 ? new Date(best).toISOString() : null;
}
