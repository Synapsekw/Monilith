"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { ColorChip } from "@/components/ui/color-chip";
import { RevealOnHover } from "@/components/ui/reveal-on-hover";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
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
  /** The board the links point at. When set, each chip opens its linked item
   *  there; without it the chips are plain labels. */
  targetBoardId?: string;
};

export function RelationCell({
  links,
  allowMultiple,
  loadCandidates,
  onChange,
  readOnly = false,
  maxChips = 2,
  targetBoardId,
}: RelationCellProps) {
  const [open, setOpen] = useState(false);
  // `search` is the raw input value (instant echo, every keystroke); `query` is
  // the debounced value that actually drives the server fetch. Typing updates
  // `search` immediately and schedules `query` ~200ms after the last keystroke,
  // so each keystroke no longer costs a `loadCandidates` round-trip.
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<RelationCandidate[]>([]);

  const debouncedSetQuery = useDebouncedCallback(setQuery, 200);

  function handleSearch(value: string) {
    setSearch(value);
    debouncedSetQuery(value);
  }

  // Reset the search when the popover closes so the next open starts clean.
  // `.cancel()` drops any still-pending debounce — without it, a timer scheduled
  // just before close would fire after the reset and leave a stale `query` that
  // the next open would fetch with.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      debouncedSetQuery.cancel();
      setSearch("");
      setQuery("");
    }
  }

  // Lazy-load candidates when the picker opens or the debounced query changes.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadCandidates(query).then((c) => {
      if (alive) setCandidates(c);
    });
    return () => {
      alive = false;
    };
  }, [open, query, loadCandidates]);

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

  const chips = shown.map((l) => {
    const status = l.linkedItemStatus ?? null;
    // Status is carried by colour AND by the label in the name/tooltip, which
    // also shows a name the cell had to truncate.
    const label = status
      ? `${l.linkedItemName} · ${status.label}`
      : (l.linkedItemName ?? "");
    const chip = status ? (
      <ColorChip
        color={status.color}
        className="min-w-0 hover:-translate-y-px hover:brightness-110"
      >
        <span className="truncate">{l.linkedItemName}</span>
      </ColorChip>
    ) : (
      <span className="bg-surface hover:border-border-hover inline-flex max-w-full min-w-0 items-center rounded-sm border px-2.5 py-0.5 text-xs font-medium transition-colors">
        <span className="truncate">{l.linkedItemName}</span>
      </span>
    );
    if (!targetBoardId)
      return (
        <span key={l.id} title={label} className="inline-flex min-w-0">
          {chip}
        </span>
      );
    return (
      <Link
        key={l.id}
        href={`/boards/${targetBoardId}?item=${l.linkedItemId}`}
        // A board shows dozens of these, each a distinct URL — prefetching
        // them would fire an RSC request per visible row.
        prefetch={false}
        title={label}
        aria-label={`Open ${label}`}
        onClick={(e) => e.stopPropagation()}
        className="focus-visible:ring-ring inline-flex min-w-0 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        {chip}
      </Link>
    );
  });

  const chipRow = (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
      {chips}
      {overflow > 0 && (
        <span className="text-muted-foreground shrink-0 text-xs">
          +{overflow} more
        </span>
      )}
    </div>
  );

  // Read-only cells (viewers) render the chips without an editor.
  if (readOnly)
    return (
      <div className="flex h-full w-full items-center px-1">{chipRow}</div>
    );

  // An empty cell is one big "add" target; a filled one keeps the chips
  // clickable and moves editing to a pencil that appears on hover (always
  // visible on touch).
  const trigger = isEmpty ? (
    <button
      type="button"
      aria-label="Edit linked items"
      className={cn(
        "flex h-full w-full items-center gap-1.5 overflow-hidden rounded px-1 text-left",
        "hover:bg-state-hover focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      <span className="text-muted-foreground inline-flex size-5 shrink-0 items-center justify-center rounded border border-dashed pointer-coarse:size-11">
        <Plus className="size-3.5" />
      </span>
    </button>
  ) : (
    <button
      type="button"
      aria-label="Edit linked items"
      className={cn(
        "text-muted-foreground inline-flex size-6 shrink-0 items-center justify-center rounded pointer-coarse:size-11",
        "hover:bg-state-hover hover:text-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      <Pencil className="size-3.5" />
    </button>
  );

  const popover = (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <RelationPicker
          candidates={candidates}
          selectedIds={selectedIds}
          searchValue={search}
          onToggle={toggle}
          onSearch={handleSearch}
          allowMultiple={allowMultiple}
        />
      </PopoverContent>
    </Popover>
  );

  // One stable tree for both states, so the picker stays mounted (and keeps
  // its place) when the first link is added or the last one removed. Only the
  // reveal differs: an empty cell's add target is always visible.
  return (
    <div
      className={cn(
        "group flex h-full w-full min-w-0 items-center gap-1",
        !isEmpty && "px-1",
      )}
    >
      {!isEmpty && chipRow}
      <RevealOnHover
        className={isEmpty ? "h-full flex-1 opacity-100" : "shrink-0"}
      >
        {popover}
      </RevealOnHover>
    </div>
  );
}
