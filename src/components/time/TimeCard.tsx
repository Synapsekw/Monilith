"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/time/hours";
import { upsertTimeAllocation, deleteTimeAllocation } from "@/lib/time/actions";
import type { TimeCardCell, TimeCardData, TimeCardRow } from "@/lib/time/types";
import { TimeCell } from "./TimeCell";
import { AddRowPicker, type PickedRow } from "./AddRowPicker";

const DAY = 86_400_000;
/** Trailing-debounce window: one router.refresh() this long after the last cell
 * edit in a burst reconciles /time (timer merges, server totals) once. */
const REFRESH_DEBOUNCE_MS = 2000;
const editKey = (rowKey: string, day: string) => `${rowKey}::${day}`;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const toMs = (d: string) => Date.parse(d + "T00:00:00Z");

function dayLabel(isoDate: string): string {
  return new Date(toMs(isoDate)).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
function weekLabel(start: string): string {
  return new Date(toMs(start)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Weekly time card. Week navigation is a genuine RSC nav (each week is a
 * distinct server window; the loaded horizon is one week — bounded read).
 * Cell edits are Server Actions reconciled into a durable local overlay; one
 * trailing-debounced router.refresh() reconciles /time per edit burst. */
export function TimeCard({
  data,
  categories,
}: {
  data: TimeCardData;
  categories: string[];
}) {
  const router = useRouter();
  const [, startNav] = useTransition();
  // Locally-added empty rows (from the picker) not yet persisted.
  const [extraRows, setExtraRows] = useState<TimeCardRow[]>([]);

  // Durable overlay of cell edits, keyed `${rowKey}::${day}` → manual seconds.
  // Set optimistically on commit (so per-row Total, daily totals, and week total
  // move in step), reverted on failure, and reconciled from the action's written
  // seconds on success. Unlike useOptimistic it does NOT auto-clear when the
  // transition settles — it must hold the acknowledged value until the coalesced
  // router.refresh() lands fresh data.rows, so a committed cell never flickers.
  const [localEdits, setLocalEdits] = useState<Map<string, number>>(
    () => new Map(),
  );
  // The server week window is authoritative: when it changes (week nav landed),
  // drop the overlay. Adjust-during-render keeps it in step with no effect churn.
  const [lastWeekStart, setLastWeekStart] = useState(data.weekStart);
  if (data.weekStart !== lastWeekStart) {
    setLastWeekStart(data.weekStart);
    setLocalEdits(new Map());
  }

  const setEdit = (rowKey: string, day: string, secs: number) =>
    setLocalEdits((prev) => new Map(prev).set(editKey(rowKey, day), secs));

  // Trailing-debounced single refresh per edit burst; cleared on unmount.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );
  function scheduleRefresh() {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  // A cell's effective manual seconds: the overlay value if one exists for this
  // (row, day), else the server value.
  const effManual = (rowKey: string, cell: TimeCardCell) =>
    localEdits.get(editKey(rowKey, cell.day)) ?? cell.manualSecs;

  function gotoWeek(deltaWeeks: number) {
    const next = iso(toMs(data.weekStart) + deltaWeeks * 7 * DAY);
    startNav(() => router.push(`/time?week=${next}`));
  }

  const rows = useMemo(() => {
    // Merge server rows with locally-added rows the user hasn't filled yet,
    // de-duping by key (a server row wins).
    const keys = new Set(data.rows.map((r) => r.key));
    return [...data.rows, ...extraRows.filter((r) => !keys.has(r.key))];
  }, [data.rows, extraRows]);

  function addRow(pick: PickedRow) {
    const key =
      pick.kind === "item" ? `item:${pick.itemId}` : `cat:${pick.category}`;
    if (rows.some((r) => r.key === key)) return;
    setExtraRows((prev) => [
      ...prev,
      {
        key,
        kind: pick.kind,
        itemId: pick.itemId ?? null,
        boardId: pick.boardId ?? null,
        boardName: null,
        category: pick.category ?? null,
        label: pick.label,
        cells: data.days.map((day) => ({ day, manualSecs: 0, timerSecs: 0 })),
        totalSecs: 0,
      },
    ]);
  }

  // Restore the overlay entry for a cell to what it was before an edit (used to
  // revert a failed mutation). `undefined` prior value means "no overlay" → the
  // cell falls back to the server value.
  function revertEdit(rowKey: string, day: string, prev: number | undefined) {
    setLocalEdits((map) => {
      const next = new Map(map);
      if (prev === undefined) next.delete(editKey(rowKey, day));
      else next.set(editKey(rowKey, day), prev);
      return next;
    });
  }

  function commitCell(row: TimeCardRow, day: string, hours: number) {
    const prev = localEdits.get(editKey(row.key, day));
    setEdit(row.key, day, Math.round(hours * 3600)); // optimistic
    void (async () => {
      const res = await upsertTimeAllocation({
        workDate: day,
        itemId: row.itemId ?? undefined,
        boardId: row.boardId ?? undefined,
        category: row.category ?? undefined,
        hours,
      });
      if (res.ok)
        setEdit(row.key, day, res.data.durationSecs); // reconcile
      else revertEdit(row.key, day, prev);
      scheduleRefresh();
    })();
  }

  function clearCell(row: TimeCardRow, day: string) {
    const prev = localEdits.get(editKey(row.key, day));
    setEdit(row.key, day, 0); // optimistic
    void (async () => {
      const res = await deleteTimeAllocation({
        workDate: day,
        itemId: row.itemId ?? undefined,
        category: row.category ?? undefined,
      });
      if (!res.ok) revertEdit(row.key, day, prev);
      scheduleRefresh();
    })();
  }

  const dayTotals = data.days.map((day) =>
    rows.reduce((s, r) => {
      const c = r.cells.find((x) => x.day === day);
      return s + (c ? effManual(r.key, c) + c.timerSecs : 0);
    }, 0),
  );
  const weekTotal = dayTotals.reduce((s, x) => s + x, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">My Time</h1>
          <p className="text-muted-foreground text-xs">
            Log hours per task or category, by day. Saved as you go.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Previous week"
            onClick={() => gotoWeek(-1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="font-mono text-sm font-medium tabular-nums">
            Week of {weekLabel(data.weekStart)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Next week"
            onClick={() => gotoWeek(1)}
          >
            <ChevronRight aria-hidden />
          </Button>
          <AddRowPicker categories={categories} onPick={addRow} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="bg-card sticky left-0 z-30 w-64 min-w-64 border-r border-b px-4 py-2 text-left">
                <Kicker>Task / Category</Kicker>
              </th>
              {data.days.map((day) => (
                <th
                  key={day}
                  className="bg-card min-w-20 border-b px-2 py-2 text-center"
                >
                  <Kicker>{dayLabel(day)}</Kicker>
                </th>
              ))}
              <th className="bg-card min-w-20 border-b border-l px-2 py-2 text-center">
                <Kicker>Total</Kicker>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              // Overlay-aware per-row total so the Total column moves in step
              // with an edited cell (server row.totalSecs lags until the
              // coalesced router.refresh() lands fresh data.rows).
              const rowTotal = row.cells.reduce(
                (s, c) => s + effManual(row.key, c) + c.timerSecs,
                0,
              );
              return (
                <tr key={row.key} className="group">
                  <td className="bg-background group-hover:bg-state-hover/20 sticky left-0 z-10 w-64 min-w-64 border-r border-b px-4 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {row.label}
                      </p>
                      <p className="text-muted-foreground text-2xs truncate">
                        {row.kind === "item"
                          ? (row.boardName ?? "Item")
                          : "Category"}
                      </p>
                    </div>
                  </td>
                  {row.cells.map((cell) => (
                    <td
                      key={cell.day}
                      className="border-b px-1.5 py-1.5 text-center align-middle"
                    >
                      <TimeCell
                        manualSecs={cell.manualSecs}
                        timerSecs={cell.timerSecs}
                        ariaLabel={`${row.label}, ${dayLabel(cell.day)}`}
                        onCommit={(h) => commitCell(row, cell.day, h)}
                        onClear={() => clearCell(row, cell.day)}
                      />
                    </td>
                  ))}
                  <td className="border-b border-l px-2 py-1.5 text-center align-middle font-mono tabular-nums">
                    {formatHours(rowTotal) || "0"}h
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={data.days.length + 2}
                  className="text-muted-foreground px-4 py-10 text-center text-sm"
                >
                  No rows yet. Use “Add row” to log time against a task or
                  category.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <td className="bg-card sticky left-0 z-10 border-t border-r px-4 py-2">
                <Kicker>Daily total</Kicker>
              </td>
              {dayTotals.map((secs, i) => (
                <td
                  key={data.days[i]}
                  className={cn(
                    "border-t px-2 py-2 text-center font-mono text-xs tabular-nums",
                    secs > 0 ? "text-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {formatHours(secs) || "0"}h
                </td>
              ))}
              <td className="border-t border-l px-2 py-2 text-center font-mono text-xs font-semibold tabular-nums">
                {formatHours(weekTotal) || "0"}h
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
