"use client";

import { useId, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import type { StageSummary } from "@/lib/folders/stages";
import type { FolderBoardRef } from "@/lib/folders/types";
import { cn } from "@/lib/utils";

/** Up to this many stages render as chips; above it, one searchable menu. A
 * folder with dozens of stages would otherwise spend several rows of every
 * Command Center tab on chips. */
export const STAGE_CHIP_LIMIT = 8;

/**
 * The stage filter for a folder with many stages: one button showing the
 * selected stage (name + colour dot), opening a searchable list. The trigger's
 * accessible NAME stays "Stage"; the selection is its description — the same
 * split `TimezonePicker` uses, so a screen reader hears what the field is.
 */
function StageMenu({
  stages,
  stage,
  onStage,
}: {
  stages: StageSummary[];
  stage: string | null;
  onStage: (k: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const valueId = useId();
  const selected = stages.find((s) => s.key === stage) ?? null;
  function pick(k: string | null) {
    onStage(k);
    setOpen(false);
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-label="Stage"
          aria-describedby={valueId}
          aria-expanded={open}
          className="gap-1.5 text-xs"
        >
          {selected ? (
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
          ) : null}
          <span id={valueId} className="max-w-48 truncate">
            {selected ? selected.name : "All stages"}
          </span>
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Search stages…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No stage found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                keywords={["All stages"]}
                onSelect={() => pick(null)}
              >
                <Check
                  className={cn(
                    "size-4",
                    stage === null ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden
                />
                All stages
              </CommandItem>
              {stages.map((s) => (
                <CommandItem
                  key={s.key}
                  value={s.name}
                  onSelect={() => pick(s.key)}
                >
                  <Check
                    className={cn(
                      "size-4",
                      stage === s.key ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="truncate">{s.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Stage control (chips, or a menu above STAGE_CHIP_LIMIT) + board dropdown + mono hint (spec §5.1). Hidden stage control when ≤ 1 stage (spec §8). */
export function FilterBar({
  stages,
  boards,
  stage,
  board,
  itemCount,
  onStage,
  onBoard,
}: {
  stages: StageSummary[];
  boards: FolderBoardRef[];
  stage: string | null;
  board: string | null;
  itemCount: number;
  onStage: (k: string | null) => void;
  onBoard: (id: string | null) => void;
}) {
  const stageName = stages.find((s) => s.key === stage)?.name;
  const boardName = boards.find((b) => b.id === board)?.name ?? "All boards";
  const hint = [
    `${itemCount} items`,
    `${board ? 1 : boards.length} boards`,
    stageName,
  ]
    .filter(Boolean)
    .join(" · ");
  const chip = (active: boolean) =>
    cn(
      // Hand-rolled control: it has to buy its own 44px coarse touch target,
      // the app primitives (Button, DropdownMenuItem) get it for free.
      "focus-visible:ring-ring flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:px-3",
      active
        ? "border-border-bright bg-surface-muted text-foreground"
        : "hover:border-border-hover text-muted-foreground",
    );
  return (
    <div data-print-hide className="flex flex-wrap items-center gap-2 py-3">
      {stages.length > STAGE_CHIP_LIMIT ? (
        <StageMenu stages={stages} stage={stage} onStage={onStage} />
      ) : stages.length > 1 ? (
        <div role="group" aria-label="Stage" className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => onStage(null)}
            className={chip(stage === null)}
            aria-pressed={stage === null}
          >
            All
          </button>
          {stages.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onStage(s.key)}
              className={chip(stage === s.key)}
              aria-pressed={stage === s.key}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 text-xs"
          >
            {boardName}
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onSelect={() => onBoard(null)}>
            All boards
          </DropdownMenuItem>
          {boards.map((b) => (
            <DropdownMenuItem key={b.id} onSelect={() => onBoard(b.id)}>
              {b.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="text-muted-foreground ml-auto font-mono text-xs">
        {hint}
      </span>
    </div>
  );
}
