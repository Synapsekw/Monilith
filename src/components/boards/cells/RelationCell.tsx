"use client";

import { Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { sortLinks, type RelationLink } from "@/lib/boards/relations";
import { RelationPicker, type RelationCandidate } from "./RelationPicker";

export type RelationCellProps = {
  links: RelationLink[];
  allowMultiple: boolean;
  candidates: RelationCandidate[];
  onSearch: (q: string) => void;
  onToggle: (linkedItemId: string) => void;
  /** Parent loads candidates lazily when the picker opens. */
  onOpenChange?: (open: boolean) => void;
  readOnly?: boolean;
  maxChips?: number;
};

export function RelationCell({
  links,
  allowMultiple,
  candidates,
  onSearch,
  onToggle,
  onOpenChange,
  readOnly = false,
  maxChips = 2,
}: RelationCellProps) {
  // Drop links whose target name is RLS-filtered (not readable by this user).
  const visible = sortLinks(links).filter((l) => l.linkedItemName !== null);
  const shown = visible.slice(0, maxChips);
  const overflow = visible.length - shown.length;
  const isEmpty = shown.length === 0;
  const selectedIds = visible.map((l) => l.linkedItemId);

  const trigger = (
    <button
      type="button"
      aria-label="Edit linked items"
      disabled={readOnly}
      className={cn(
        "flex h-full w-full items-center gap-1.5 overflow-hidden rounded px-1 text-left",
        "hover:bg-accent focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        "disabled:pointer-events-none",
      )}
    >
      {shown.map((l) => (
        <span
          key={l.id}
          className="bg-surface inline-flex max-w-[140px] items-center gap-1.5 truncate rounded-md border px-2 py-0.5 text-xs"
        >
          <span
            aria-hidden
            className="bg-muted-foreground/50 size-2 shrink-0 rounded-full"
          />
          <span className="truncate">{l.linkedItemName}</span>
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-muted-foreground shrink-0 text-xs">
          +{overflow} more
        </span>
      )}
      {isEmpty && !readOnly && (
        <span className="text-muted-foreground inline-flex size-5 shrink-0 items-center justify-center rounded border border-dashed">
          <Plus className="size-3.5" />
        </span>
      )}
    </button>
  );

  // Read-only cells (viewers) render the chips without an editor popover.
  if (readOnly) return trigger;

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <RelationPicker
          candidates={candidates}
          selectedIds={selectedIds}
          onToggle={onToggle}
          onSearch={onSearch}
          allowMultiple={allowMultiple}
        />
      </PopoverContent>
    </Popover>
  );
}
