"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDashboardMutations } from "@/lib/dashboards/use-dashboard-mutations";

export type BoardOption = {
  id: string;
  name: string;
  numbersColumns: { id: string; name: string }[];
  statusColumns: { id: string; name: string }[];
  allColumns: { id: string; name: string; kind: string }[];
};

type Kind = "number" | "chart" | "battery" | "list";

const selectClass =
  "bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm";

export function AddWidgetDialog({
  dashboardId,
  boards,
}: {
  dashboardId: string;
  boards: BoardOption[];
}) {
  const { addWidget } = useDashboardMutations(dashboardId);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("number");
  const [boardId, setBoardId] = useState(boards[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [agg, setAgg] = useState<"count" | "sum" | "avg">("count");
  const [valueColumnId, setValueColumnId] = useState("");
  const [groupColumnId, setGroupColumnId] = useState("");
  const [chartStyle, setChartStyle] = useState<"bar" | "pie">("bar");
  const [columnIds, setColumnIds] = useState<string[]>([]);
  const [limit, setLimit] = useState(25);
  const [error, setError] = useState<string | null>(null);

  const board = boards.find((b) => b.id === boardId);
  const numbersCols = board?.numbersColumns ?? [];
  const statusCols = board?.statusColumns ?? [];

  function reset() {
    setTitle("");
    setAgg("count");
    setValueColumnId("");
    setGroupColumnId("");
    setChartStyle("bar");
    setColumnIds([]);
    setLimit(25);
    setKind("number");
  }

  function submit() {
    setError(null);
    if (!boardId) return setError("Pick a source board.");

    let config: Record<string, unknown>;
    if (kind === "number") {
      if (agg !== "count" && !valueColumnId)
        return setError("Pick a numbers column for sum/average.");
      config = agg === "count" ? { agg } : { agg, valueColumnId };
    } else if (kind === "list") {
      config = { columnIds, limit };
    } else {
      // chart + battery both group by a status column
      if (!groupColumnId) return setError("Pick a status column to group by.");
      config =
        kind === "chart" ? { groupColumnId, chartStyle } : { groupColumnId };
    }

    addWidget.mutate(
      { kind, sourceBoardId: boardId, title, config },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
        },
        onError: (e) => setError(e.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-1.5 size-4" /> Add widget
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a widget</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="text-sm">
            Widget type
            <select
              className={selectClass}
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              <option value="number">Number</option>
              <option value="chart">Chart</option>
              <option value="battery">Battery</option>
              <option value="list">List</option>
            </select>
          </label>

          <label className="text-sm">
            Source board
            <select
              className={selectClass}
              value={boardId}
              onChange={(e) => {
                // Reset column pickers — a column id from the old board would
                // otherwise persist a widget grouped/valued by the wrong board.
                setBoardId(e.target.value);
                setGroupColumnId("");
                setValueColumnId("");
                setColumnIds([]);
              }}
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Title
            <Input
              className="mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. By status"
            />
          </label>

          {kind === "number" ? (
            <>
              <label className="text-sm">
                Metric
                <select
                  className={selectClass}
                  value={agg}
                  onChange={(e) =>
                    setAgg(e.target.value as "count" | "sum" | "avg")
                  }
                >
                  <option value="count">Count of items</option>
                  <option value="sum">Sum of a number column</option>
                  <option value="avg">Average of a number column</option>
                </select>
              </label>
              {agg !== "count" ? (
                <label className="text-sm">
                  Number column
                  <select
                    className={selectClass}
                    value={valueColumnId}
                    onChange={(e) => setValueColumnId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {numbersCols.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          ) : kind === "list" ? (
            <>
              <fieldset className="text-sm">
                <legend className="mb-1">Columns to show</legend>
                <div className="flex flex-col gap-1 rounded-md border p-2">
                  {(board?.allColumns ?? []).length === 0 ? (
                    <span className="text-muted-foreground text-xs">
                      This board has no columns.
                    </span>
                  ) : (
                    board?.allColumns.map((c) => (
                      <label key={c.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="accent-primary size-4"
                          checked={columnIds.includes(c.id)}
                          onChange={(e) =>
                            setColumnIds((prev) =>
                              e.target.checked
                                ? [...prev, c.id]
                                : prev.filter((id) => id !== c.id),
                            )
                          }
                        />
                        {c.name}
                      </label>
                    ))
                  )}
                </div>
              </fieldset>
              <label className="text-sm">
                Max rows
                <Input
                  type="number"
                  min={1}
                  max={100}
                  className="mt-1"
                  value={limit}
                  onChange={(e) =>
                    setLimit(
                      Math.min(Math.max(Number(e.target.value) || 1, 1), 100),
                    )
                  }
                />
              </label>
            </>
          ) : (
            <>
              <label className="text-sm">
                Group by (status column)
                <select
                  className={selectClass}
                  value={groupColumnId}
                  onChange={(e) => setGroupColumnId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {statusCols.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {kind === "chart" ? (
                <label className="text-sm">
                  Chart style
                  <select
                    className={selectClass}
                    value={chartStyle}
                    onChange={(e) =>
                      setChartStyle(e.target.value as "bar" | "pie")
                    }
                  >
                    <option value="bar">Bar</option>
                    <option value="pie">Pie</option>
                  </select>
                </label>
              ) : null}
            </>
          )}

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={addWidget.isPending}>
            Add widget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
