import type {
  TimeAllocationRow,
  TimeCardCell,
  TimeCardData,
  TimeCardRow,
  TimerSecsByItemDay,
} from "./types";

const DAY = 86_400_000;

function isoToUTC(iso: string): number {
  return Date.parse(iso + "T00:00:00Z");
}
function utcToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 7 ISO dates from a Monday-start week (Mon..Sun). */
export function weekDays(weekStart: string): string[] {
  const base = isoToUTC(weekStart);
  return Array.from({ length: 7 }, (_, i) => utcToIso(base + i * DAY));
}

interface ItemMeta {
  name: string;
  boardName: string | null;
}

/** Pure assembly of a week's card from manual allocations + timer totals +
 * item metadata. Manual and timer are distinct sources (no double count): a
 * cell carries `manualSecs` (editable) and `timerSecs` (read-only); the row
 * total sums both. Allocations/timer outside the week window are ignored. */
export function assembleTimeCard(input: {
  weekStart: string;
  userId: string;
  allocations: TimeAllocationRow[];
  timer: TimerSecsByItemDay[];
  itemMeta: Map<string, ItemMeta>;
}): TimeCardData {
  const { weekStart, userId, allocations, timer, itemMeta } = input;
  const days = weekDays(weekStart);
  const daySet = new Set(days);

  // rowKey -> { meta..., cells map(day -> {manual,timer}) }
  type Acc = {
    kind: "item" | "category";
    itemId: string | null;
    boardId: string | null;
    boardName: string | null;
    category: string | null;
    label: string;
    cells: Map<string, { manual: number; timer: number }>;
  };
  const rows = new Map<string, Acc>();

  const ensure = (key: string, seed: Omit<Acc, "cells">): Acc => {
    let a = rows.get(key);
    if (!a) {
      a = { ...seed, cells: new Map() };
      rows.set(key, a);
    }
    return a;
  };
  const cellOf = (a: Acc, day: string) => {
    let c = a.cells.get(day);
    if (!c) {
      c = { manual: 0, timer: 0 };
      a.cells.set(day, c);
    }
    return c;
  };

  for (const al of allocations) {
    if (!daySet.has(al.work_date)) continue;
    if (al.item_id) {
      const meta = itemMeta.get(al.item_id);
      const a = ensure(`item:${al.item_id}`, {
        kind: "item",
        itemId: al.item_id,
        boardId: al.board_id,
        boardName: meta?.boardName ?? null,
        category: null,
        label: meta?.name ?? "Untitled item",
      });
      cellOf(a, al.work_date).manual += al.duration_secs;
    } else if (al.category) {
      const a = ensure(`cat:${al.category}`, {
        kind: "category",
        itemId: null,
        boardId: null,
        boardName: null,
        category: al.category,
        label: al.category,
      });
      cellOf(a, al.work_date).manual += al.duration_secs;
    }
  }

  for (const t of timer) {
    if (!daySet.has(t.day)) continue;
    const meta = itemMeta.get(t.itemId);
    const a = ensure(`item:${t.itemId}`, {
      kind: "item",
      itemId: t.itemId,
      boardId: null,
      boardName: meta?.boardName ?? null,
      category: null,
      label: meta?.name ?? "Untitled item",
    });
    cellOf(a, t.day).timer += t.secs;
  }

  const out: TimeCardRow[] = [...rows.entries()].map(([key, a]) => {
    const cells: TimeCardCell[] = days.map((day) => {
      const c = a.cells.get(day) ?? { manual: 0, timer: 0 };
      return { day, manualSecs: c.manual, timerSecs: c.timer };
    });
    const totalSecs = cells.reduce((s, c) => s + c.manualSecs + c.timerSecs, 0);
    return {
      key,
      kind: a.kind,
      itemId: a.itemId,
      boardId: a.boardId,
      boardName: a.boardName,
      category: a.category,
      label: a.label,
      cells,
      totalSecs,
    };
  });

  // Stable order: items (by label) first, then categories (by label).
  out.sort((x, y) => {
    if (x.kind !== y.kind) return x.kind === "item" ? -1 : 1;
    return x.label.localeCompare(y.label);
  });

  return { weekStart, days, rows: out, userId };
}

/** ISO date of the Monday on/before the given ISO date (week start = Monday). */
export function mondayOf(iso: string): string {
  const d = new Date(isoToUTC(iso));
  const wd = d.getUTCDay(); // 0=Sun..6=Sat
  const back = wd === 0 ? 6 : wd - 1;
  return utcToIso(isoToUTC(iso) - back * DAY);
}
