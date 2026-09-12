"use client";

import { memo, useState, useTransition } from "react";
import { Maximize2 } from "lucide-react";
import type { Item } from "@/lib/boards/queries";
import {
  NAME_FREEZE_EDGE,
  NAME_FREEZE_SHADOW,
} from "@/components/boards/SummaryRow";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isOptimisticId } from "@/lib/boards/optimistic-id";
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
  intelMatch,
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
  /** Board Intelligence: true = active chip's rule paints inside this frozen column. */
  intelMatch?: boolean | null;
}) {
  const [editing, setEditing] = useState(autoFocusRename);
  const [name, setName] = useState(item.name);
  const [isPending, startTransition] = useTransition();
  // Temp-row rule (see @/lib/boards/optimistic-id): while the row's id is
  // client-minted, a rename would PATCH an id the server doesn't have and
  // `?item=<id>` would resolve to nothing — so neither affordance arms until
  // the server row replaces it (one round-trip). Dimmed to say so.
  const pending = isOptimisticId(item.id);

  function open() {
    if (pending) return;
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
        {intelMatch === true && (
          <span aria-hidden data-testid="intel-rule" className="intel-rule" />
        )}
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
        // Hover seam: a 2px periwinkle rule that wipes in from the left edge.
        // `after:` is the seam, `before:` is the selected bar — a selected row
        // owns x=0, so the seam hides rather than stacking on top of it.
        // `ease-keystone` on the host doesn't reach `::after` (timing function
        // isn't inherited), so it's restated as `after:ease-keystone`; the
        // duration uses the named motion scale via its CSS var — a bare
        // `duration-standard` class compiles to nothing (Tailwind 4.3 has no
        // `--duration-*` utility namespace, only the `--transition-duration`
        // one; see vault/sessions/2026-08-02-2012-keystone-wash-and-polish.md).
        //
        // Plain `hover:`, NOT `group-hover/name:` — this `after:` pseudo
        // belongs to the SAME element that carries `group/name`. Tailwind
        // compiles `group-hover/name:after:scale-y-100` to
        // `.group-hover\/name\:after\:scale-y-100:is(:where(.group\/name):hover *):after`
        // — the trailing ` *` requires the styled node to be a DESCENDANT of
        // the hovered `.group/name`, which this node can never be of itself,
        // so that rule can never match (verified by reading the compiled CSS
        // chunk in Chromium: the selector exists, but no node can satisfy
        // it). The hover seam was consequently dead on every row on this
        // branch until this fix — a regression jsdom cannot catch, since it
        // renders no CSS selectors at all. `hover:` targets `:hover` on this
        // same node directly, which is exactly what "mouse is over this row"
        // means here; `group/name` stays for the OTHER
        // `group-hover/name:opacity-100` reveals below (the drag handle, open
        // and add-subitem buttons), which correctly target DESCENDANT
        // elements and were unaffected.
        "after:bg-primary after:ease-keystone after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:w-[2px] after:origin-center after:scale-y-0 after:transition-transform after:duration-[var(--duration-standard)] after:content-[''] hover:after:scale-y-100",
        // Selected: opaque periwinkle wash (via style, above) + a 3px accent bar
        // (::before, inset 6px). The bar is pointer-events-none so it never
        // blocks the checkbox/drag targets.
        selected
          ? cn(
              "before:bg-primary before:pointer-events-none before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded",
              "after:hidden",
              // The intel rule owns x=0 while a chip is active; the periwinkle
              // wash still says "selected" on its own.
              intelMatch === true && "before:hidden",
            )
          : indented
            ? "bg-surface-sunken hover:bg-surface"
            : "bg-surface hover:bg-surface-muted",
        // `name-freeze-edge` is a bare marker class (asserted by
        // BoardTable.test.tsx's "marks the Name header and name cells as the
        // freeze edge") — its shadow itself is reproduced below as a real
        // element, NOT via `NAME_FREEZE_EDGE`'s own `after:` rules, because
        // this wrapper's `::after` is now spoken for by the hover seam above;
        // stacking both `after:` rule sets on one pseudo-element would collide
        // (competing left-0/right-0, width, transform and background).
        "name-freeze-edge",
      )}
    >
      {/* Frozen-edge scroll shadow — a real node so it doesn't fight the hover
          seam for this wrapper's `::after`. NAME_FREEZE_SHADOW is a hand-
          written literal kept in lockstep with NAME_FREEZE_EDGE (used by
          SummaryRow/GroupHeaderRow/GroupRollupRow) by a test, not by runtime
          derivation — see the comment above both constants in SummaryRow.tsx
          for why. */}
      <span aria-hidden className={NAME_FREEZE_SHADOW} />
      {intelMatch === true && (
        <span aria-hidden data-testid="intel-rule" className="intel-rule" />
      )}
      {leading}
      <div
        role="button"
        // Temp-row rule: `open()` is a no-op while pending, so keeping this in
        // the tab order would be a dead stop announcing itself as a button.
        tabIndex={pending ? -1 : 0}
        aria-label={`${item.name} name`}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        aria-disabled={pending || undefined}
        className={cn(
          "focus-visible:ring-ring text-item flex h-full min-w-0 flex-1 items-center truncate font-medium tracking-[-0.011em] focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
          pending ? "cursor-default opacity-60" : "cursor-pointer",
          indented ? "pl-10" : "px-4",
        )}
      >
        {item.name}
      </div>
      {!pending && (
        <button
          type="button"
          aria-label={`Open ${item.name}`}
          onClick={() => openItemPanel(item.id)}
          className="hover:bg-state-hover text-muted-foreground hover:text-foreground focus-visible:ring-ring grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11 pointer-coarse:opacity-100"
        >
          <Maximize2 className="size-3.5" />
        </button>
      )}
      {trailing}
    </div>
  );
});
