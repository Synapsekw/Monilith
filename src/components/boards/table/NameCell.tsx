"use client";

import { memo, useEffect, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { Maximize2 } from "lucide-react";
import type { Item } from "@/lib/boards/queries";
import {
  NAME_FREEZE_EDGE,
  NAME_FREEZE_RULE,
  NAME_FREEZE_SHADOW,
} from "@/components/boards/SummaryRow";
import { Input } from "@/components/ui/input";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
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

/** How long the pointer rests on a row before a truncated name unrolls. */
export const NAME_PEEK_DELAY_MS = 200;

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
const SEAM_CLASSES =
  "after:bg-primary after:ease-keystone after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:w-[2px] after:origin-center after:scale-y-0 after:transition-transform after:duration-[var(--duration-standard)] after:content-[''] hover:after:scale-y-100";

/**
 * The built-in primary "Name" cell.
 *
 * Fine pointers: the leading gutter (drag handle, checkbox, chevron slot) is
 * followed by the name, which takes all the remaining width. The open-panel
 * button and the `trailing` controls are an overlay on the right edge and take
 * no width. When the name is still truncated, resting on the row unrolls the
 * cell to its full one-line width over the neighbouring cells (the "peek").
 *
 * Coarse pointers: no overlay and no peek. The same container is in flow and
 * always visible, with 44px controls.
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
  peekDisabled = false,
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
  /** The row is being dragged: never unroll the name. */
  peekDisabled?: boolean;
}) {
  const [editing, setEditing] = useState(autoFocusRename);
  const [name, setName] = useState(item.name);
  const [isPending, startTransition] = useTransition();
  // Temp-row rule (see @/lib/boards/optimistic-id): while the row's id is
  // client-minted, a rename would PATCH an id the server doesn't have and
  // `?item=<id>` would resolve to nothing — so neither affordance arms until
  // the server row replaces it (one round-trip). Dimmed to say so.
  const pending = isOptimisticId(item.id);
  const coarse = useCoarsePointer();
  const textRef = useRef<HTMLSpanElement>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // null = closed. Open = capped to the scroller's visible width, read once
  // when it opens (the cell is `sticky left-0`, so its left edge is the
  // scroller's left edge).
  const [peek, setPeek] = useState<{
    cap: number | undefined;
    by: "hover" | "focus";
  } | null>(null);
  const peeking = peek !== null && !coarse && !peekDisabled;

  // Virtualised rows unmount constantly: never leave a pending timer behind.
  useEffect(
    () => () => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
    },
    [],
  );

  function cancelPeek() {
    if (peekTimer.current) {
      clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
    setPeek(null);
  }

  function isTruncated(): boolean {
    const el = textRef.current;
    return el !== null && el.scrollWidth > el.clientWidth;
  }

  function openPeek(by: "hover" | "focus") {
    const scroller = textRef.current?.closest<HTMLElement>(
      "[data-scroll-container]",
    );
    setPeek({ cap: scroller ? scroller.clientWidth : undefined, by });
  }

  function armPeek() {
    if (coarse || peekDisabled || !isTruncated()) return;
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => {
      peekTimer.current = null;
      openPeek("hover");
    }, NAME_PEEK_DELAY_MS);
  }

  function open() {
    if (pending) return;
    cancelPeek();
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
          "sticky left-0 z-10 flex items-center pr-2 pl-1",
          indented ? "bg-surface-sunken" : "bg-surface",
          NAME_FREEZE_EDGE,
          NAME_FREEZE_RULE,
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
          className="h-6 px-1.5 pointer-coarse:h-8"
        />
      </div>
    );
  }

  return (
    <div
      data-peek={peeking ? "true" : undefined}
      onMouseEnter={armPeek}
      onMouseLeave={() => {
        // A keyboard-opened peek outlives the pointer; only a hover peek
        // (or a pending one) closes here.
        if (peekTimer.current) {
          clearTimeout(peekTimer.current);
          peekTimer.current = null;
        }
        setPeek((cur) => (cur?.by === "focus" ? cur : null));
      }}
      onBlur={(e) => {
        // A focus peek closes when focus leaves the whole cell, not when it
        // moves to a button inside it.
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setPeek((cur) => (cur?.by === "focus" ? null : cur));
      }}
      // The frozen Name column is `sticky left-0`, so the other columns scroll
      // UNDERNEATH it — its background MUST be opaque. The background is one
      // custom property, `--name-bg`, so the buttons overlay can fade to
      // exactly the colour this cell is painted in (resting, hovered, sunken
      // or selected). Selected is an opaque composite, never a translucent
      // `bg-primary/[0.08]`, for the same reason as before.
      style={
        {
          ...(selected
            ? {
                "--name-bg": `color-mix(in srgb, var(--primary) 8%, var(--${
                  indented ? "surface-sunken" : "surface"
                }))`,
              }
            : null),
          // The peek: let the cell grow past its grid track, to the width of
          // its content on one line, capped to the visible scroller.
          ...(peeking
            ? { width: "max-content", minWidth: "100%", maxWidth: peek?.cap }
            : null),
        } as CSSProperties
      }
      className={cn(
        "group/name ease-keystone relative sticky left-0 z-10 flex h-full items-center bg-[var(--name-bg)] pl-1 transition-colors pointer-coarse:pr-2",
        SEAM_CLASSES,
        // Selected: opaque periwinkle wash (via --name-bg, above) + a 3px
        // accent bar (::before, inset 6px), pointer-events-none.
        selected
          ? cn(
              "before:bg-primary before:pointer-events-none before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded",
              "after:hidden",
              // The intel rule owns x=0 while a chip is active; the periwinkle
              // wash still says "selected" on its own.
              intelMatch === true && "before:hidden",
            )
          : indented
            ? "[--name-bg:var(--color-surface-sunken)] hover:[--name-bg:var(--color-surface)]"
            : "[--name-bg:var(--color-surface)] hover:[--name-bg:var(--color-surface-muted)]",
        // Bare marker class asserted by BoardTable.test.tsx; the shadow itself
        // is the real <span> below (this wrapper's ::after is the hover seam).
        "name-freeze-edge",
        NAME_FREEZE_RULE,
        // Peek: above the row hairline (z-20) and any presence ring (z-10) of
        // the neighbouring cells, inside this row's own stacking context. The
        // hairline brightens; `shadow-panel` is the one sanctioned shadow.
        // Listed AFTER NAME_FREEZE_RULE so `border-border-bright` wins.
        peeking && "border-border-bright shadow-panel z-30",
      )}
    >
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
        title={item.name}
        onClick={open}
        onFocus={(e) => {
          if (coarse || peekDisabled || !isTruncated()) return;
          // Keyboard focus only: a mouse click also focuses this div and
          // must still wait for the 200ms rest.
          let visible = false;
          try {
            visible = e.currentTarget.matches(":focus-visible");
          } catch {
            visible = false;
          }
          if (visible) openPeek("focus");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        aria-disabled={pending || undefined}
        className={cn(
          "focus-visible:ring-ring flex h-full min-w-0 flex-1 items-center focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
          // Subitem names sit at the cell scale; item names one step up.
          indented
            ? "text-cell font-normal"
            : "text-item font-medium tracking-[-0.011em]",
          pending ? "cursor-default opacity-60" : "cursor-pointer",
          indented ? "pr-2 pl-10" : "pr-2 pl-1",
        )}
      >
        {/* The text is its own truncating box: `text-overflow` does not draw
            an ellipsis for text placed directly in a flex container. This is
            also the node the peek measures. */}
        <span ref={textRef} className="min-w-0 truncate">
          {item.name}
        </span>
      </div>
      <div
        data-testid="name-actions"
        className={cn(
          "flex shrink-0 items-center pr-1 pointer-coarse:pointer-events-auto pointer-coarse:static pointer-coarse:bg-none pointer-coarse:pr-0 pointer-coarse:pl-0 pointer-coarse:opacity-100",
          peeking
            ? "static opacity-100"
            : "pointer-events-none absolute inset-y-0 right-0 bg-[linear-gradient(to_right,transparent,var(--name-bg)_1.25rem)] pl-6 opacity-0 transition-opacity group-hover/name:opacity-100 focus-within:opacity-100 [&>*]:pointer-events-auto",
        )}
      >
        {!pending && (
          <button
            type="button"
            aria-label={`Open ${item.name}`}
            onClick={() => openItemPanel(item.id)}
            className="hover:bg-state-hover text-muted-foreground hover:text-foreground focus-visible:ring-ring grid size-6 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 group-data-[peek=true]/name:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11 pointer-coarse:opacity-100"
          >
            <Maximize2 className="size-3.5" />
          </button>
        )}
        {trailing}
      </div>
    </div>
  );
});
