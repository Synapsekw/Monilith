"use client";

import { useState } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, X } from "lucide-react";

import {
  addOption,
  recolorOption,
  removeOption,
  renameOption,
  reorderOptions,
} from "@/lib/boards/option-edit";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import { OPTION_COLORS } from "@/lib/boards/option-colors";
import { pillTextColor } from "@/lib/boards/contrast";
import type { ColumnOption } from "@/lib/validations/boards";
import type { CacheColumn } from "@/lib/boards/cache";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function settingsOptions(column: CacheColumn): ColumnOption[] {
  return (column.settings as { options?: ColumnOption[] }).options ?? [];
}

/**
 * Edits a status/dropdown column's options. Label/color/order edits are
 * non-destructive and applied locally, persisted in one shot via {@link onSave}.
 * Removing an option that's in use is destructive (clears cells) and routes
 * through {@link onRemoveOption} (the remove RPC) behind a confirm; a 0-usage
 * removal is purely local and only lands on Save.
 */
export function ColumnOptionsDialog({
  open,
  column,
  usageOf,
  onSave,
  onRemoveOption,
  onOpenChange,
}: {
  open: boolean;
  column: CacheColumn;
  usageOf: (optionId: string) => number;
  onSave: (settings: { options: ColumnOption[] }) => void;
  onRemoveOption: (optionId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Keyed on the column so reopening / switching columns remounts the
            editor — local state re-seeds via its useState initializer (no
            effect, so abandoned edits are discarded). */}
        <OptionsEditor
          key={column.id}
          column={column}
          usageOf={usageOf}
          onSave={onSave}
          onRemoveOption={onRemoveOption}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function OptionsEditor({
  column,
  usageOf,
  onSave,
  onRemoveOption,
  onOpenChange,
}: {
  column: CacheColumn;
  usageOf: (optionId: string) => number;
  onSave: (settings: { options: ColumnOption[] }) => void;
  onRemoveOption: (optionId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [options, setOptions] = useState<ColumnOption[]>(() =>
    settingsOptions(column),
  );
  const [confirmRemove, setConfirmRemove] = useState<ColumnOption | null>(null);
  // The freshly-added option whose label input should grab focus.
  const [focusId, setFocusId] = useState<string | null>(null);

  const sensors = useTouchAwareSensors();

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = options.findIndex((o) => o.id === active.id);
    const to = options.findIndex((o) => o.id === over.id);
    if (from === -1 || to === -1) return;
    setOptions((prev) => reorderOptions(prev, from, to));
  }

  function handleRemove(option: ColumnOption) {
    if (usageOf(option.id) > 0) {
      setConfirmRemove(option);
      return;
    }
    setOptions((prev) => removeOption(prev, option.id));
  }

  function confirmDestructiveRemove() {
    if (!confirmRemove) return;
    onRemoveOption(confirmRemove.id);
    setOptions((prev) => removeOption(prev, confirmRemove.id));
    setConfirmRemove(null);
  }

  function save() {
    onSave({ options });
    onOpenChange(false);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit labels</DialogTitle>
        <DialogDescription>
          Rename, recolor, reorder, add, or remove the options for “
          {column.name}”.
        </DialogDescription>
      </DialogHeader>

      <DndContext
        sensors={sensors}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={options.map((o) => o.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-1.5">
            {options.map((option) => (
              <OptionRow
                key={option.id}
                option={option}
                autoFocus={option.id === focusId}
                onRecolor={(color) =>
                  setOptions((prev) => recolorOption(prev, option.id, color))
                }
                onRename={(label) =>
                  setOptions((prev) => renameOption(prev, option.id, label))
                }
                onRemove={() => handleRemove(option)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Add option"
        className="self-start"
        onClick={() => {
          const next = addOption(options);
          setOptions(next);
          setFocusId(next[next.length - 1].id);
        }}
      >
        <Plus />
        Add option
      </Button>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="button" onClick={save}>
          Save
        </Button>
      </DialogFooter>

      <AlertDialog
        open={confirmRemove !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this label?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRemove
                ? `${usageOf(confirmRemove.id)} items use “${confirmRemove.label}”. Deleting clears them.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={confirmDestructiveRemove}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function OptionRow({
  option,
  autoFocus,
  onRecolor,
  onRename,
  onRemove,
}: {
  option: ColumnOption;
  autoFocus: boolean;
  onRecolor: (color: string) => void;
  onRename: (label: string) => void;
  onRemove: () => void;
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: option.id });
  const [colorOpen, setColorOpen] = useState(false);

  return (
    <li
      ref={setNodeRef}
      style={{
        // CSS.Translate (not CSS.Transform) — drop the scale so rows don't
        // stretch/squish during drag (documented gotcha).
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn("flex items-center gap-1.5", isDragging && "relative z-10")}
    >
      <button
        type="button"
        aria-label={`Reorder ${option.label}`}
        {...attributes}
        {...listeners}
        className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md active:cursor-grabbing pointer-coarse:size-11"
      >
        <GripVertical className="size-4" />
      </button>

      <Popover open={colorOpen} onOpenChange={setColorOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Color for ${option.label}`}
            style={{ backgroundColor: option.color }}
            className="focus-visible:ring-ring size-6 shrink-0 rounded-md focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11"
          />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <div className="grid grid-cols-5 gap-1.5">
            {OPTION_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Set color ${c}`}
                onClick={() => {
                  onRecolor(c);
                  setColorOpen(false);
                }}
                style={{ backgroundColor: c }}
                className={cn(
                  "focus-visible:ring-ring size-6 rounded-md focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11",
                  option.color.toLowerCase() === c.toLowerCase() &&
                    "ring-foreground ring-offset-background ring-2 ring-offset-1",
                )}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Input
        autoFocus={autoFocus}
        value={option.label}
        onChange={(e) => onRename(e.target.value)}
        aria-label={`Label for ${option.label}`}
        className="h-7"
        style={{
          backgroundColor: option.color,
          color: pillTextColor(option.color),
        }}
      />

      <button
        type="button"
        aria-label={`remove ${option.label}`}
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive grid size-7 shrink-0 place-items-center rounded-md pointer-coarse:size-11"
      >
        <X className="size-4" />
      </button>
    </li>
  );
}
