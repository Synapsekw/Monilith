"use client";

import { useMemo, useState } from "react";
import { FolderInput, Tag, Trash2, UserPlus, X } from "lucide-react";
import { useBoardSelection } from "@/stores/board-selection";
import { useBulkMutations } from "@/lib/boards/use-bulk-mutations";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ClearOptionButton,
  StatusOptionList,
} from "@/components/boards/cells/editors/status-options";
import type { EditorMember } from "@/components/boards/cells/editors";
import type { Column } from "@/lib/boards/queries";
import type { ColumnOption } from "@/lib/validations/boards";
import { cn } from "@/lib/utils";

type BulkGroup = { id: string; name: string };

/**
 * Floating contextual toolbar for the Table view's row multi-select. Renders
 * only while ≥1 row is selected; reads the selection from the shared client
 * store (never server data) and fires a bounded, server-side bulk action for
 * each verb. Monochrome chrome — the ONE place color appears is the status pills
 * inside the "Set status" picker (they carry the option's color, as everywhere).
 *
 * Reuses the exact option/member pickers the inline cell editors use, so a bulk
 * status/assign reads identically to editing a single cell.
 */
export function BoardBulkBar({
  boardId,
  groups,
  columns,
  members,
}: {
  boardId: string;
  groups: BulkGroup[];
  columns: Column[];
  members: EditorMember[];
}) {
  const selectedIds = useBoardSelection((s) => s.selectedIds);
  const clear = useBoardSelection((s) => s.clear);
  const ids = useMemo(() => [...selectedIds], [selectedIds]);
  const count = ids.length;

  const bulk = useBulkMutations(boardId);

  const statusColumns = useMemo(
    () => columns.filter((c) => c.kind === "status"),
    [columns],
  );
  const peopleColumns = useMemo(
    () => columns.filter((c) => c.kind === "people"),
    [columns],
  );

  const [confirmDelete, setConfirmDelete] = useState(false);

  if (count === 0) return null;

  function runAndClear(fn: () => void) {
    fn();
    clear();
  }

  return (
    <div
      role="toolbar"
      aria-label={`${count} selected`}
      className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4"
    >
      <div className="bg-surface pointer-events-auto flex items-center gap-1 rounded-lg border p-1 shadow-lg">
        <span
          aria-live="polite"
          className="text-foreground px-2 text-sm font-medium tabular-nums"
        >
          {count} selected
        </span>
        <span className="bg-border mx-0.5 h-5 w-px" aria-hidden />

        {/* Move to group */}
        {groups.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <FolderInput aria-hidden />
                Move to
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-52">
              {groups.map((g) => (
                <DropdownMenuItem
                  key={g.id}
                  onSelect={() => runAndClear(() => bulk.bulkMove(ids, g.id))}
                  className="truncate"
                >
                  {g.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Set status */}
        {statusColumns.length > 0 && (
          <ColumnValuePopover
            trigger={
              <Button variant="ghost" size="sm">
                <Tag aria-hidden />
                Status
              </Button>
            }
            columns={statusColumns}
            label="Set status"
            render={(col, done) => (
              <StatusOptionList
                options={
                  ((col.settings ?? {}) as { options?: ColumnOption[] })
                    .options ?? []
                }
                selected={null}
                onSelect={(optionId) => {
                  runAndClear(() =>
                    bulk.bulkSetCell(ids, col.id, { optionId }),
                  );
                  done();
                }}
                onClear={() => {
                  runAndClear(() => bulk.bulkSetCell(ids, col.id, null));
                  done();
                }}
              />
            )}
          />
        )}

        {/* Assign people */}
        {peopleColumns.length > 0 && (
          <ColumnValuePopover
            trigger={
              <Button variant="ghost" size="sm">
                <UserPlus aria-hidden />
                Assign
              </Button>
            }
            columns={peopleColumns}
            label="Assign people"
            render={(col, done) => (
              <PeopleAssignList
                members={members}
                onApply={(userIds) => {
                  runAndClear(() =>
                    bulk.bulkSetCell(
                      ids,
                      col.id,
                      userIds.length ? { userIds } : null,
                    ),
                  );
                  done();
                }}
              />
            )}
          />
        )}

        {/* Delete */}
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 aria-hidden />
          Delete
        </Button>

        <span className="bg-border mx-0.5 h-5 w-px" aria-hidden />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear selection"
          onClick={() => clear()}
        >
          <X aria-hidden />
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move {count} {count === 1 ? "item" : "items"} to Trash?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The selected {count === 1 ? "item" : "items"} and all of their
              subitems move to Trash. You can restore{" "}
              {count === 1 ? "it" : "them"} from Trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => runAndClear(() => bulk.bulkArchive(ids))}
            >
              Move to Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * A popover that first lets the user pick WHICH column to target (only when the
 * board has more than one status/people column) and then renders that column's
 * value picker. With a single column it skips straight to the picker.
 */
function ColumnValuePopover({
  trigger,
  columns,
  label,
  render,
}: {
  trigger: React.ReactNode;
  columns: Column[];
  label: string;
  render: (col: Column, done: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(
    columns.length === 1 ? columns[0].id : null,
  );
  const active = columns.find((c) => c.id === activeId) ?? null;

  function done() {
    setOpen(false);
    setActiveId(columns.length === 1 ? columns[0].id : null);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setActiveId(columns.length === 1 ? columns[0].id : null);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="center"
        className="flex max-h-[min(20rem,var(--radix-popover-content-available-height))] min-w-[12rem] flex-col gap-0.5 overflow-auto p-1"
        aria-label={label}
      >
        {active ? (
          render(active, done)
        ) : (
          <>
            <p className="text-muted-foreground px-2 py-1 text-xs">
              Choose a column
            </p>
            {columns.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveId(c.id)}
                className="hover:bg-accent focus-visible:ring-ring truncate rounded-md px-2 py-1 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {c.name}
              </button>
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Multi-select member list with an explicit Apply (bulk assign replaces the
 *  people set on every selected item). Mirrors the inline PeopleEditor styling. */
function PeopleAssignList({
  members,
  onApply,
}: {
  members: EditorMember[];
  onApply: (userIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  return (
    <>
      {members.length === 0 ? (
        <span className="text-muted-foreground px-2 py-1 text-sm">
          No members
        </span>
      ) : (
        members.map((m) => {
          const isSelected = selected.includes(m.userId);
          const name = m.fullName ?? m.email ?? m.userId;
          return (
            <button
              key={m.userId}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => toggle(m.userId)}
              className={cn(
                "hover:bg-accent focus-visible:ring-ring flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
                isSelected && "bg-accent",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  isSelected ? "bg-primary" : "bg-muted-foreground/40",
                )}
              />
              <span className="truncate">{name}</span>
            </button>
          );
        })
      )}
      <div className="mt-1 flex items-center justify-between border-t px-1 pt-1">
        <ClearOptionButton onClear={() => onApply([])} />
        <Button size="xs" onClick={() => onApply(selected)}>
          Apply
        </Button>
      </div>
    </>
  );
}
