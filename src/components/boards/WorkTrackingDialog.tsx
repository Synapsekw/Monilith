"use client";

import { useState, useTransition, type TransitionStartFunction } from "react";

import { updateBoardWorkSettings } from "@/lib/boards/actions/work-settings";
import {
  guessDueColumn,
  guessStatusColumn,
  looksDoneLabel,
} from "@/lib/boards/work-guess";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const SELECT_CLASS =
  "border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50 dark:bg-input/30";

export type WorkTrackingColumn = {
  id: string;
  name: string;
  kind: string;
  position: number;
  settings: unknown;
};

export type WorkTrackingSettings = {
  statusColumnId: string | null;
  doneOptionIds: string[] | null;
  dueColumnId: string | null;
};

type Option = { id: string; label: string; color?: string };

function optionsOf(column: WorkTrackingColumn | undefined): Option[] {
  const raw = (column?.settings as { options?: unknown } | null)?.options;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (o): o is Option =>
        !!o && typeof o.id === "string" && typeof o.label === "string",
    )
    .map((o) => ({ id: o.id, label: o.label, color: o.color }));
}

function guessedDoneOptions(column: WorkTrackingColumn | undefined): Option[] {
  return optionsOf(column).filter((o) => looksDoneLabel(o.label));
}

function GuessedDonePreview({
  options,
  className,
}: {
  options: Option[];
  className: string;
}) {
  return (
    <p className={cn("text-muted-foreground", className)}>
      {options.length > 0
        ? `Currently treated as done: ${options.map((o) => o.label).join(", ")}`
        : "No option looks like done yet, so every item counts as open."}
    </p>
  );
}

function byPosition(kind: string, columns: WorkTrackingColumn[]) {
  return columns
    .filter((c) => c.kind === kind)
    .sort((a, b) => a.position - b.position);
}

/**
 * Work tracking (spec 4.2): which column is the status, which of its options
 * mean done, and which column is the due date. "Automatic" leaves a setting
 * null so Today and the assistant fall back to their live guess. The Server
 * Action re-validates everything; this dialog only offers sensible choices.
 */
export function WorkTrackingDialog({
  open,
  onOpenChange,
  boardId,
  columns,
  current,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  /** All columns of the board. */
  columns: WorkTrackingColumn[];
  current: WorkTrackingSettings;
  /** Called with the values that were just saved, before the dialog closes. */
  onSaved?: (saved: WorkTrackingSettings) => void;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    // While a save is in flight, Escape / outside click / the close button must
    // not dismiss the dialog, or a failure message would be dropped unseen.
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!isPending}>
        {/* Radix unmounts the content when closed, so the form re-seeds from
            `current` on every open and abandoned edits are discarded. */}
        <WorkTrackingForm
          boardId={boardId}
          columns={columns}
          current={current}
          onSaved={onSaved}
          onOpenChange={onOpenChange}
          isPending={isPending}
          startTransition={startTransition}
        />
      </DialogContent>
    </Dialog>
  );
}

function WorkTrackingForm({
  boardId,
  columns,
  current,
  onSaved,
  onOpenChange,
  isPending,
  startTransition,
}: {
  boardId: string;
  columns: WorkTrackingColumn[];
  current: WorkTrackingSettings;
  onSaved?: (saved: WorkTrackingSettings) => void;
  /** The unguarded close, used once a save has succeeded. */
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  startTransition: TransitionStartFunction;
}) {
  const statusColumns = byPosition("status", columns);
  const dateColumns = byPosition("date", columns);

  const [statusId, setStatusId] = useState(() =>
    statusColumns.some((c) => c.id === current.statusColumnId)
      ? (current.statusColumnId as string)
      : "",
  );
  const [doneIds, setDoneIds] = useState<string[]>(() => {
    const col = statusColumns.find((c) => c.id === current.statusColumnId);
    const known = new Set(optionsOf(col).map((o) => o.id));
    return (current.doneOptionIds ?? []).filter((id) => known.has(id));
  });
  const [dueId, setDueId] = useState(() =>
    dateColumns.some((c) => c.id === current.dueColumnId)
      ? (current.dueColumnId as string)
      : "",
  );
  const [error, setError] = useState<string | null>(null);

  const chosenStatus = statusColumns.find((c) => c.id === statusId);
  // The same guesses public.item_facts makes, so "Automatic" shows what
  // Today and the assistant will actually use.
  const guessedStatus = guessStatusColumn(columns);
  const guessedDone = guessedDoneOptions(guessedStatus);
  const guessedDue = guessDueColumn(columns);

  function changeStatus(next: string) {
    setStatusId(next);
    // Done options belong to one status column; never carry them across.
    setDoneIds([]);
  }

  function toggle(optionId: string) {
    setDoneIds((prev) =>
      prev.includes(optionId)
        ? prev.filter((id) => id !== optionId)
        : [...prev, optionId],
    );
  }

  function save() {
    setError(null);
    const saved: WorkTrackingSettings = {
      statusColumnId: statusId || null,
      // None ticked means "use the label guess within this column".
      doneOptionIds: statusId && doneIds.length > 0 ? doneIds : null,
      dueColumnId: dueId || null,
    };
    startTransition(async () => {
      const res = await updateBoardWorkSettings({ boardId, ...saved });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved?.(saved);
      onOpenChange(false);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Work tracking</DialogTitle>
        <DialogDescription>
          Tells Today and the assistant which items are done and when they are
          due.
        </DialogDescription>
      </DialogHeader>

      {statusColumns.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          This board has no status column, so every item counts as open.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="work-status-column">Status column</Label>
            <select
              id="work-status-column"
              className={SELECT_CLASS}
              value={statusId}
              onChange={(e) => changeStatus(e.target.value)}
            >
              <option value="">Automatic ({guessedStatus?.name})</option>
              {statusColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm leading-none font-medium">
              Done when status is
            </legend>
            {chosenStatus ? (
              <>
                {optionsOf(chosenStatus).map((o) => {
                  const checked = doneIds.includes(o.id);
                  return (
                    <label
                      key={o.id}
                      className={cn(
                        "hover:bg-state-hover/40 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                        checked && "bg-accent/50",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="accent-primary size-3.5"
                        checked={checked}
                        onChange={() => toggle(o.id)}
                      />
                      <span
                        aria-hidden
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: o.color }}
                      />
                      {o.label}
                    </label>
                  );
                })}
                <p className="text-muted-foreground text-xs">
                  Leave all unticked to treat options named like Done, Complete
                  or Cancelled as done.
                </p>
                {/* Nothing ticked: the view applies the label guess within
                    the chosen column, so preview it here too. */}
                {doneIds.length === 0 ? (
                  <GuessedDonePreview
                    options={guessedDoneOptions(chosenStatus)}
                    className="text-xs"
                  />
                ) : null}
              </>
            ) : (
              <GuessedDonePreview options={guessedDone} className="text-sm" />
            )}
          </fieldset>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="work-due-column">Due date column</Label>
        <select
          id="work-due-column"
          className={SELECT_CLASS}
          value={dueId}
          onChange={(e) => setDueId(e.target.value)}
        >
          <option value="">
            {guessedDue
              ? `Automatic (${guessedDue.name})`
              : "Automatic (no date column)"}
          </option>
          {dateColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={isPending}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
