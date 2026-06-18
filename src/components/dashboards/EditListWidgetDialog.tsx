"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FilterBuilder } from "@/components/dashboards/FilterBuilder";
import type { BoardOption } from "@/components/dashboards/AddWidgetDialog";
import { useDashboardMutations } from "@/lib/dashboards/use-dashboard-mutations";
import type { CacheWidget } from "@/lib/dashboards/cache";
import type { ListFilter } from "@/lib/validations/dashboards";

export function EditListWidgetDialog({
  widget,
  board,
  dashboardId,
  open,
  onOpenChange,
}: {
  widget: CacheWidget;
  board: BoardOption | undefined;
  dashboardId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { editWidget } = useDashboardMutations(dashboardId);
  const cfg = (widget.config ?? {}) as {
    columnIds?: string[];
    limit?: number;
    filter?: ListFilter;
  };
  const [columnIds, setColumnIds] = useState<string[]>(cfg.columnIds ?? []);
  const [limit, setLimit] = useState(cfg.limit ?? 25);
  const [filter, setFilter] = useState<ListFilter>(
    cfg.filter ?? { combinator: "and", conditions: [] },
  );
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const config =
      filter.conditions.length > 0
        ? { columnIds, limit, filter }
        : { columnIds, limit };
    editWidget.mutate(
      { widgetId: widget.id, config },
      {
        onSuccess: () => onOpenChange(false),
        onError: (e) => setError(e.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit list widget</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <fieldset className="text-sm">
            <legend className="mb-1">Columns to show</legend>
            <div className="flex flex-col gap-1 rounded-md border p-2">
              {(board?.allColumns ?? []).length === 0 ? (
                <span className="text-muted-foreground text-xs">
                  This board has no columns.
                </span>
              ) : (
                (board?.allColumns ?? []).map((c) => (
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
          <FilterBuilder
            columns={board?.allColumns ?? []}
            value={filter}
            onChange={setFilter}
          />
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={editWidget.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
