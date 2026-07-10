"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kicker } from "@/components/ui/kicker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { searchAllocatableItems } from "@/lib/time/actions";

export interface PickedRow {
  kind: "item" | "category";
  itemId?: string;
  boardId?: string;
  category?: string;
  label: string;
}

/** "+ Add row" picker: searches items across readable boards and offers
 * category suggestions (presets + the user's previously-used). Calls back with
 * the chosen row; the parent inserts an empty editable row into the card. */
export function AddRowPicker({
  categories,
  onPick,
}: {
  categories: string[];
  onPick: (row: PickedRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<
    { id: string; name: string; boardId: string; boardName: string | null }[]
  >([]);
  const [, startTransition] = useTransition();

  function onQueryChange(q: string) {
    setQuery(q);
    startTransition(async () => {
      setItems(q.trim() === "" ? [] : await searchAllocatableItems(q));
    });
  }

  const categoryMatches = categories.filter((c) =>
    c.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const typedIsNewCategory =
    query.trim() !== "" &&
    !categories.some((c) => c.toLowerCase() === query.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Plus aria-hidden className="size-3.5" /> Add row
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={onQueryChange}
            placeholder="Search items or type a category…"
          />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            {items.length > 0 ? (
              <CommandGroup heading={<Kicker>Items</Kicker>}>
                {items.map((it) => (
                  <CommandItem
                    key={it.id}
                    value={`item-${it.id}`}
                    onSelect={() => {
                      onPick({
                        kind: "item",
                        itemId: it.id,
                        boardId: it.boardId,
                        label: it.name,
                      });
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="truncate">{it.name}</span>
                    {it.boardName ? (
                      <span className="text-muted-foreground ml-auto text-xs">
                        {it.boardName}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandGroup heading={<Kicker>Categories</Kicker>}>
              {categoryMatches.map((c) => (
                <CommandItem
                  key={c}
                  value={`cat-${c}`}
                  onSelect={() => {
                    onPick({ kind: "category", category: c, label: c });
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {c}
                </CommandItem>
              ))}
              {typedIsNewCategory ? (
                <CommandItem
                  value={`new-${query}`}
                  onSelect={() => {
                    const c = query.trim();
                    onPick({ kind: "category", category: c, label: c });
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  Add category “{query.trim()}”
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
