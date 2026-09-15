"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { StageSummary } from "@/lib/folders/stages";
import type { FolderBoardRef } from "@/lib/folders/types";
import { cn } from "@/lib/utils";

/** Stage segmented control + board dropdown + mono hint (spec §5.1). Hidden stage control when ≤ 1 stage (spec §8). */
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
      {stages.length > 1 ? (
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
