"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import {
  addBoardToPortfolio,
  getStatusColumnsForBoard,
} from "@/lib/portfolios/actions";
import type { StatusColumn } from "@/lib/portfolios/queries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const DONE_RE = /done|complete|closed/i;
const SELECT_CLASS =
  "border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50 dark:bg-input/30";

export function AddBoardDialog({
  portfolioId,
  boards,
}: {
  portfolioId: string;
  boards: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [boardId, setBoardId] = useState<string>("");
  const [columns, setColumns] = useState<StatusColumn[]>([]);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [doneColumnId, setDoneColumnId] = useState<string | null>(null);
  const [doneOptionIds, setDoneOptionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setBoardId("");
    setColumns([]);
    setDoneColumnId(null);
    setDoneOptionIds([]);
    setError(null);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  /** Apply the default "done" mapping for a freshly selected status column. */
  function applyColumnDefaults(column: StatusColumn | undefined) {
    if (!column) {
      setDoneColumnId(null);
      setDoneOptionIds([]);
      return;
    }
    setDoneColumnId(column.id);
    setDoneOptionIds(
      column.options.filter((o) => DONE_RE.test(o.label)).map((o) => o.id),
    );
  }

  async function onBoardChange(nextBoardId: string) {
    setBoardId(nextBoardId);
    setError(null);
    setColumns([]);
    setDoneColumnId(null);
    setDoneOptionIds([]);
    if (!nextBoardId) return;

    setLoadingColumns(true);
    const res = await getStatusColumnsForBoard(nextBoardId);
    setLoadingColumns(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setColumns(res.data.columns);
    applyColumnDefaults(res.data.columns[0]);
  }

  function onColumnChange(value: string) {
    if (value === "") {
      // "No mapping" — progress stays n/a for this board.
      setDoneColumnId(null);
      setDoneOptionIds([]);
      return;
    }
    applyColumnDefaults(columns.find((c) => c.id === value));
  }

  function toggleOption(optionId: string) {
    setDoneOptionIds((prev) =>
      prev.includes(optionId)
        ? prev.filter((id) => id !== optionId)
        : [...prev, optionId],
    );
  }

  function submit() {
    if (!boardId) return;
    setError(null);
    startTransition(async () => {
      const res = await addBoardToPortfolio({
        portfolioId,
        boardId,
        doneColumnId,
        doneOptionIds: doneColumnId ? doneOptionIds : [],
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  const activeColumn = columns.find((c) => c.id === doneColumnId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" disabled={boards.length === 0}>
          <Plus aria-hidden />
          Add board
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add board to portfolio</DialogTitle>
          <DialogDescription>
            Pick a board and choose which status counts as “done” so progress
            can be calculated.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-board-select">Board</Label>
            <select
              id="add-board-select"
              className={SELECT_CLASS}
              value={boardId}
              onChange={(e) => void onBoardChange(e.target.value)}
            >
              <option value="" disabled>
                Select a board…
              </option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {boardId ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-board-status-column">
                Completion status
              </Label>
              {loadingColumns ? (
                <p className="text-muted-foreground text-xs">
                  Loading status columns…
                </p>
              ) : columns.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  This board has no status columns — progress will show as n/a.
                </p>
              ) : (
                <>
                  <select
                    id="add-board-status-column"
                    className={SELECT_CLASS}
                    value={doneColumnId ?? ""}
                    onChange={(e) => onColumnChange(e.target.value)}
                  >
                    <option value="">No mapping (progress n/a)</option>
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  {activeColumn ? (
                    <fieldset className="mt-1 flex flex-col gap-1.5">
                      <legend className="text-muted-foreground mb-1 text-xs">
                        Statuses that count as done
                      </legend>
                      {activeColumn.options.length === 0 ? (
                        <p className="text-muted-foreground text-xs">
                          No statuses defined on this column.
                        </p>
                      ) : (
                        activeColumn.options.map((o) => {
                          const checked = doneOptionIds.includes(o.id);
                          return (
                            <label
                              key={o.id}
                              className={cn(
                                "hover:bg-accent/40 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                                checked && "bg-accent/50",
                              )}
                            >
                              <input
                                type="checkbox"
                                className="accent-primary size-3.5"
                                checked={checked}
                                onChange={() => toggleOption(o.id)}
                              />
                              <span
                                aria-hidden
                                className="size-2.5 rounded-full"
                                style={{ backgroundColor: o.color }}
                              />
                              {o.label}
                            </label>
                          );
                        })
                      )}
                    </fieldset>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={isPending || !boardId}>
              {isPending ? "Adding…" : "Add board"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
