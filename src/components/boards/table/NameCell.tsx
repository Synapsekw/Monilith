"use client";

import { memo, useState, useTransition } from "react";
import { Maximize2 } from "lucide-react";
import type { Item } from "@/lib/boards/queries";
import { NAME_FREEZE_EDGE } from "@/components/boards/SummaryRow";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CellControls } from "./shared";

/**
 * Open the item detail panel by setting `?item=<id>` via the History API — no
 * RSC navigation, so the board page's queries don't re-run (mirrors how
 * `ViewSwitcher` sets `?view=`). {@link BoardViews} reads the param and renders
 * the panel.
 */
function openItemPanel(itemId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("item", itemId);
  window.history.pushState({}, "", url);
}

/**
 * The built-in primary "Name" cell. Supports optional leading (chevron/spacer),
 * trailing (add-subitem + row menu), indented layout, and auto-focus rename.
 */
export const NameCell = memo(function NameCell({
  item,
  controls,
  leading,
  trailing,
  indented = false,
  selected = false,
  autoFocusRename = false,
  onRenameSettled,
}: {
  item: Item;
  controls: CellControls;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  indented?: boolean;
  /** Row is bulk-selected — frozen cell carries the periwinkle wash + accent bar. */
  selected?: boolean;
  autoFocusRename?: boolean;
  onRenameSettled?: () => void;
}) {
  const [editing, setEditing] = useState(autoFocusRename);
  const [name, setName] = useState(item.name);
  const [isPending, startTransition] = useTransition();

  function open() {
    setName(item.name);
    setEditing(true);
  }

  function commit() {
    const trimmed = name.trim();
    setEditing(false);
    onRenameSettled?.();
    if (!trimmed || trimmed === item.name) return;
    startTransition(async () => {
      controls.renameItemInCache({ itemId: item.id, name: trimmed });
    });
  }

  if (editing) {
    return (
      <div
        className={cn(
          "sticky left-0 z-10 flex items-center px-4",
          indented ? "bg-surface-sunken" : "bg-surface",
          NAME_FREEZE_EDGE,
        )}
      >
        {leading}
        <Input
          autoFocus
          value={name}
          disabled={isPending}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              onRenameSettled?.();
            }
          }}
          aria-label={`Rename ${item.name}`}
          className="h-7"
        />
      </div>
    );
  }

  return (
    <div
      // The frozen Name column is `sticky left-0`, so the other columns scroll
      // UNDERNEATH it — its background MUST be opaque or scrolled content bleeds
      // through. The selection tint therefore can't be a translucent
      // `bg-primary/[0.08]`; use an opaque composite (periwinkle mixed into the
      // surface) that reads identically to the row wash but occludes fully.
      style={
        selected
          ? {
              backgroundColor: `color-mix(in srgb, var(--primary) 8%, var(--${
                indented ? "surface-sunken" : "surface"
              }))`,
            }
          : undefined
      }
      className={cn(
        "group/name ease-keystone relative sticky left-0 z-10 flex h-full items-center pr-2 transition-colors",
        // Selected: opaque periwinkle wash (via style, above) + a 3px accent bar
        // (::before, inset 6px). The bar is pointer-events-none so it never
        // blocks the checkbox/drag targets.
        selected
          ? "before:bg-primary before:pointer-events-none before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded"
          : indented
            ? "bg-surface-sunken hover:bg-surface"
            : "bg-surface hover:bg-surface-muted",
        NAME_FREEZE_EDGE,
      )}
    >
      {leading}
      <div
        role="button"
        tabIndex={0}
        aria-label={`${item.name} name`}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        className={cn(
          "focus-visible:ring-ring flex h-full min-w-0 flex-1 cursor-pointer items-center truncate text-sm focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
          indented ? "pl-8" : "px-4",
        )}
      >
        {item.name}
      </div>
      <button
        type="button"
        aria-label={`Open ${item.name}`}
        onClick={() => openItemPanel(item.id)}
        className="hover:bg-accent text-muted-foreground hover:text-foreground focus-visible:ring-ring grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11 pointer-coarse:opacity-100"
      >
        <Maximize2 className="size-3.5" />
      </button>
      {trailing}
    </div>
  );
});
