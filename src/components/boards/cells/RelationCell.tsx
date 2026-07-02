"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { sortLinks, type RelationLink } from "@/lib/boards/relations";
import { RelationPicker, type RelationCandidate } from "./RelationPicker";

/** The selected linked items a cell resolves to after an edit. */
export type RelationSelection = {
  linkedItemId: string;
  linkedItemName: string | null;
};

export type RelationCellProps = {
  links: RelationLink[];
  allowMultiple: boolean;
  /** Fetches target-board candidates (RLS-scoped) for the picker. */
  loadCandidates: (search: string) => Promise<RelationCandidate[]>;
  /** Called with the full new selection after a toggle. */
  onChange: (selection: RelationSelection[]) => void;
  readOnly?: boolean;
  maxChips?: number;
};

export function RelationCell({
  links,
  allowMultiple,
  loadCandidates,
  onChange,
  readOnly = false,
  maxChips = 2,
}: RelationCellProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<RelationCandidate[]>([]);

  // Lazy-load candidates when the picker opens or the search changes.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadCandidates(search).then((c) => {
      if (alive) setCandidates(c);
    });
    return () => {
      alive = false;
    };
  }, [open, search, loadCandidates]);

  const ordered = sortLinks(links);
  const selectedIds = ordered.map((l) => l.linkedItemId);
  // Drop links whose target name is RLS-filtered (not readable by this user).
  const visible = ordered.filter((l) => l.linkedItemName !== null);
  const shown = visible.slice(0, maxChips);
  const overflow = visible.length - shown.length;
  const isEmpty = shown.length === 0;

  function toggle(candidateId: string) {
    const current: RelationSelection[] = ordered.map((l) => ({
      linkedItemId: l.linkedItemId,
      linkedItemName: l.linkedItemName,
    }));
    const exists = current.some((s) => s.linkedItemId === candidateId);
    const cand = candidates.find((c) => c.id === candidateId);
    const added: RelationSelection = {
      linkedItemId: candidateId,
      linkedItemName: cand?.name ?? null,
    };
    let next: RelationSelection[];
    if (allowMultiple) {
      next = exists
        ? current.filter((s) => s.linkedItemId !== candidateId)
        : [...current, added];
    } else {
      next = exists ? [] : [added];
    }
    onChange(next);
  }

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
        <span className="text-muted-foreground inline-flex size-5 shrink-0 items-center justify-center rounded border border-dashed pointer-coarse:size-11">
          <Plus className="size-3.5" />
        </span>
      )}
    </button>
  );

  // Read-only cells (viewers) render the chips without an editor popover.
  if (readOnly) return trigger;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <RelationPicker
          candidates={candidates}
          selectedIds={selectedIds}
          onToggle={toggle}
          onSearch={setSearch}
          allowMultiple={allowMultiple}
        />
      </PopoverContent>
    </Popover>
  );
}
