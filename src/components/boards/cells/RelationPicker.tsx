"use client";

import { Search, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type RelationCandidate = { id: string; name: string };

/**
 * Presentational picker for a relation cell: a search box + a checkbox list of
 * target-board items. Data (candidates) is fetched by the parent and passed in;
 * search is driven server-side via `onSearch`. Monochrome chrome per pulse-ui —
 * the only accent is the selected check (brand).
 */
export function RelationPicker({
  candidates,
  selectedIds,
  searchValue,
  onToggle,
  onSearch,
  allowMultiple,
}: {
  candidates: RelationCandidate[];
  selectedIds: string[];
  /** Controlled raw input value — echoes each keystroke instantly, decoupled
   *  from the debounced value the parent feeds to the server fetch. */
  searchValue: string;
  onToggle: (id: string) => void;
  onSearch: (q: string) => void;
  allowMultiple: boolean;
}) {
  const selected = new Set(selectedIds);
  return (
    <div className="w-[280px]">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <Input
          autoFocus
          value={searchValue}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={allowMultiple ? "Search to link…" : "Search…"}
          aria-label="Search items to link"
          className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
        />
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {candidates.map((c) => {
          const on = selected.has(c.id);
          return (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onToggle(c.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm",
                  "hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border",
                    on && "bg-primary border-primary text-primary-foreground",
                  )}
                >
                  {on && <Check className="size-3" />}
                </span>
                <span className="truncate">{c.name}</span>
              </button>
            </li>
          );
        })}
        {candidates.length === 0 && (
          <li className="text-muted-foreground px-3 py-3 text-xs">
            No items found.
          </li>
        )}
      </ul>
    </div>
  );
}
