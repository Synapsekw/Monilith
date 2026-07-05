"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  LayoutGrid,
  Monitor,
  Moon,
  Plus,
  Rows3,
  Sun,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useUIStore } from "@/stores/ui";
import { searchItems, type ItemSearchResult } from "@/lib/search/item-search";
import type { BoardListEntry } from "@/lib/boards/queries";

const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;

export function CommandPalette({
  boards,
  dashboards,
  workspaces,
}: {
  boards: BoardListEntry[];
  dashboards: { id: string; name: string }[];
  workspaces: { id: string; name: string }[];
}) {
  const open = useUIStore((s) => s.commandOpen);
  const setOpen = useUIStore((s) => s.setCommandOpen);
  const toggle = useUIStore((s) => s.toggleCommand);
  const setNewBoardOpen = useUIStore((s) => s.setNewBoardOpen);
  const setNewDashboardOpen = useUIStore((s) => s.setNewDashboardOpen);
  const router = useRouter();
  const { setTheme } = useTheme();
  const canCreate = Boolean(workspaces[0]?.id);

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ItemSearchResult[]>([]);
  // The term the current `items` correspond to. `searching` is derived from the
  // gap between the live query and this — no setState-in-effect for a spinner.
  const [resolvedTerm, setResolvedTerm] = useState("");
  // Ignore out-of-order responses: only the latest issued request may commit.
  const requestId = useRef(0);

  const resetSearch = useCallback(() => {
    requestId.current += 1;
    setQuery("");
    setItems([]);
    setResolvedTerm("");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // Closing via ⌘K clears the query so the palette reopens fresh.
        if (useUIStore.getState().commandOpen) resetSearch();
        toggle();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle, resetSearch]);

  // Debounced server-backed item search. Sub-threshold queries never round-trip
  // (the group is hidden anyway); otherwise we wait DEBOUNCE_MS after the last
  // keystroke. setState happens only in the async callback, and the requestId
  // guard drops stale responses — no synchronous setState-in-effect.
  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY) return;
    const id = ++requestId.current;
    const handle = setTimeout(async () => {
      const results = await searchItems(term);
      if (requestId.current !== id) return;
      setItems(results);
      setResolvedTerm(term);
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const handleOpenChange = (next: boolean) => {
    if (!next) resetSearch();
    setOpen(next);
  };

  const run = (fn: () => void) => {
    resetSearch();
    setOpen(false);
    fn();
  };

  const term = query.trim();
  const showItemsGroup = term.length >= MIN_QUERY;
  const searching = showItemsGroup && term !== resolvedTerm;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command palette"
      description="Search and run actions"
    >
      <CommandInput
        placeholder="Search items or type a command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {showItemsGroup && (
          <CommandGroup heading="Items" forceMount>
            {searching ? (
              // value={query} keeps this status row visible under cmdk's filter.
              <CommandItem value={query} disabled aria-live="polite">
                <Rows3 className="size-4" /> Searching…
              </CommandItem>
            ) : items.length === 0 ? (
              <CommandItem value={query} disabled aria-live="polite">
                <Rows3 className="size-4" /> No items match
              </CommandItem>
            ) : (
              items.map((it) => (
                <CommandItem
                  key={it.id}
                  value={`item-${it.id} ${it.name} ${it.boardName}`}
                  onSelect={() =>
                    run(() =>
                      router.push(`/boards/${it.boardId}?item=${it.id}`),
                    )
                  }
                >
                  <Rows3 className="size-4" />
                  <span className="truncate">{it.name}</span>
                  <span className="text-muted-foreground ml-auto truncate pl-2 text-xs">
                    {it.boardName}
                  </span>
                </CommandItem>
              ))
            )}
          </CommandGroup>
        )}
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => run(() => router.push("/dashboards"))}>
            <LayoutDashboard className="size-4" /> Dashboards
          </CommandItem>
          {boards.map((b) => (
            <CommandItem
              key={b.id}
              value={`board ${b.name}`}
              onSelect={() => run(() => router.push(`/boards/${b.id}`))}
            >
              <LayoutGrid className="size-4" /> {b.name}
            </CommandItem>
          ))}
          {dashboards.map((d) => (
            <CommandItem
              key={d.id}
              value={`dashboard ${d.name}`}
              onSelect={() => run(() => router.push(`/dashboards/${d.id}`))}
            >
              <LayoutDashboard className="size-4" /> {d.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Create">
          <CommandItem
            disabled={!canCreate}
            onSelect={() => run(() => setNewBoardOpen(true))}
          >
            <Plus className="size-4" /> New board
          </CommandItem>
          <CommandItem
            disabled={!canCreate}
            onSelect={() => run(() => setNewDashboardOpen(true))}
          >
            <Plus className="size-4" /> New dashboard
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem onSelect={() => run(() => setTheme("light"))}>
            <Sun className="size-4" /> Light
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("dark"))}>
            <Moon className="size-4" /> Dark
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("system"))}>
            <Monitor className="size-4" /> System
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
