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
import {
  DoneMappingFields,
  defaultDoneOptionIds,
} from "@/components/goals/DoneMappingFields";

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
    setDoneOptionIds(defaultDoneOptionIds(column));
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
            <DoneMappingFields
              idPrefix="add-board"
              columns={columns}
              loading={loadingColumns}
              doneColumnId={doneColumnId}
              doneOptionIds={doneOptionIds}
              onColumnChange={(columnId) =>
                columnId === null
                  ? applyColumnDefaults(undefined)
                  : applyColumnDefaults(columns.find((c) => c.id === columnId))
              }
              onToggleOption={(optionId) =>
                setDoneOptionIds((prev) =>
                  prev.includes(optionId)
                    ? prev.filter((id) => id !== optionId)
                    : [...prev, optionId],
                )
              }
            />
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
