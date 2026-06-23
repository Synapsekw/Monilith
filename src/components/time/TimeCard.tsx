"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/time/hours";
import { upsertTimeAllocation, deleteTimeAllocation } from "@/lib/time/actions";
import type { TimeCardData, TimeCardRow } from "@/lib/time/types";
import { TimeCell } from "./TimeCell";
import { AddRowPicker, type PickedRow } from "./AddRowPicker";

const DAY = 86_400_000;
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
 * Cell edits are Server Actions with an optimistic local overlay. */
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

  function commitCell(row: TimeCardRow, day: string, hours: number) {
    startNav(async () => {
      await upsertTimeAllocation({
        workDate: day,
        itemId: row.itemId ?? undefined,
        boardId: row.boardId ?? undefined,
        category: row.category ?? undefined,
        hours,
      });
      router.refresh();
    });
  }

  function clearCell(row: TimeCardRow, day: string) {
    startNav(async () => {
      await deleteTimeAllocation({
        workDate: day,
        itemId: row.itemId ?? undefined,
        category: row.category ?? undefined,
      });
      router.refresh();
    });
  }

  const dayTotals = data.days.map((day) =>
    rows.reduce((s, r) => {
      const c = r.cells.find((x) => x.day === day);
      return s + (c ? c.manualSecs + c.timerSecs : 0);
    }, 0),
  );
  const weekTotal = dayTotals.reduce((s, x) => s + x, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
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
          <span className="text-sm font-medium tabular-nums">
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
              <th className="bg-card text-muted-foreground sticky left-0 z-30 w-64 min-w-64 border-r border-b px-4 py-2 text-left text-xs font-medium">
                Task / Category
              </th>
              {data.days.map((day) => (
                <th
                  key={day}
                  className="bg-card text-muted-foreground min-w-20 border-b px-2 py-2 text-center text-xs font-medium"
                >
                  {dayLabel(day)}
                </th>
              ))}
              <th className="bg-card text-muted-foreground min-w-20 border-b border-l px-2 py-2 text-center text-xs font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="group">
                <td className="bg-background group-hover:bg-accent/20 sticky left-0 z-10 w-64 min-w-64 border-r border-b px-4 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.label}</p>
                    <p className="text-muted-foreground truncate text-[11px]">
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
                <td className="border-b border-l px-2 py-1.5 text-center align-middle tabular-nums">
                  {formatHours(row.totalSecs) || "0"}h
                </td>
              </tr>
            ))}
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
              <td className="bg-card sticky left-0 z-10 border-t border-r px-4 py-2 text-xs font-medium">
                Daily total
              </td>
              {dayTotals.map((secs, i) => (
                <td
                  key={data.days[i]}
                  className={cn(
                    "border-t px-2 py-2 text-center text-xs tabular-nums",
                    secs > 0 ? "text-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {formatHours(secs) || "0"}h
                </td>
              ))}
              <td className="border-t border-l px-2 py-2 text-center text-xs font-semibold tabular-nums">
                {formatHours(weekTotal) || "0"}h
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
