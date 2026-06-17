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
};

export function AddWidgetDialog({
  dashboardId,
  boards,
}: {
  dashboardId: string;
  boards: BoardOption[];
}) {
  const { addWidget } = useDashboardMutations(dashboardId);
  const [open, setOpen] = useState(false);
  const [boardId, setBoardId] = useState(boards[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [agg, setAgg] = useState<"count" | "sum" | "avg">("count");
  const [valueColumnId, setValueColumnId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const numbersCols =
    boards.find((b) => b.id === boardId)?.numbersColumns ?? [];

  function submit() {
    setError(null);
    if (!boardId) return setError("Pick a source board.");
    const config: Record<string, unknown> =
      agg === "count" ? { agg } : { agg, valueColumnId };
    if (agg !== "count" && !valueColumnId)
      return setError("Pick a numbers column for sum/average.");
    addWidget.mutate(
      { kind: "number", sourceBoardId: boardId, title, config },
      {
        onSuccess: () => {
          setOpen(false);
          setTitle("");
          setAgg("count");
          setValueColumnId("");
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
          <DialogTitle>Add a Number widget</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="text-sm">
            Source board
            <select
              className="bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
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
              placeholder="e.g. Open items"
            />
          </label>
          <label className="text-sm">
            Metric
            <select
              className="bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
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
                className="bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
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
