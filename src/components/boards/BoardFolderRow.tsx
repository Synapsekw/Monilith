"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Folder, FolderOpen } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { BoardFolderMenu } from "@/components/boards/BoardFolderMenu";
import { SIDEBAR_LEAD_CLASS, SidebarRow } from "@/components/shell/sidebar-row";

/**
 * One collapsible folder in the Boards nav. A folder is a PROJECT: its name is
 * a link to the folder's command center (`/folders/<id>`) and the chevron
 * beside it is a separate control that only expands or collapses the board
 * list. They were ONE merged disclosure while a folder was a private grouping
 * with nowhere to navigate to — now there are two destinations, so there are
 * two controls.
 *
 * Open/closed state reuses
 * `useUIStore.collapsedSections` (the same persisted map `NavSection` uses),
 * keyed `folder:<id>` — so toggling a folder is 0 server round-trips and
 * survives a reload. Default open (absent key).
 *
 * The row can also be a drag drop target, but it deliberately imports nothing
 * from @dnd-kit: the `useDroppable` hook is called by the lazy drag layer
 * (`BoardsNavSortable`), which passes its `setNodeRef` and `isOver` down as
 * `dropRef` / `isOver`. That keeps the ~30-40KB dnd stack out of the shell
 * bundle that every authenticated route pays for.
 */
export function BoardFolderRow({
  folder,
  count,
  dropRef,
  isOver = false,
  children,
}: {
  folder: { id: string; name: string };
  count: number;
  dropRef?: (node: HTMLElement | null) => void;
  isOver?: boolean;
  children: ReactNode;
}) {
  const collapsedSections = useUIStore((s) => s.collapsedSections);
  const toggleSection = useUIStore((s) => s.toggleSection);
  const key = `folder:${folder.id}`;
  const bodyId = `board-folder-${folder.id}`;

  // Hovering a dragged board over a CLOSED folder opens it, so the drop lands
  // somewhere the user can actually see — but PURELY VISUALLY. The persisted
  // map is not touched.
  //
  // This used to be a `useEffect` that called `toggleSection`, i.e. a
  // localStorage write on every hover. Merely dragging PAST a folder left it
  // permanently expanded, a concurrent click fought the effect, and unmounting
  // mid-drag left the write with nothing to undo it. An `onDragCancel` handler
  // could only undo what was written; deriving `open` instead means there is
  // nothing to undo and no cancel handler is needed.
  //
  // A SUCCESSFUL drop does persist the folder open — otherwise the board the
  // user just filed disappears the moment the pointer leaves. That write lives
  // in `BoardsNavSortable.fileIntoFolder`'s success path, once, via
  // `setSection`.
  const open = !collapsedSections[key] || isOver;

  return (
    <div className="flex flex-col gap-0.5">
      <SidebarRow
        child
        // The chevron button IS the lead slot (it carries SIDEBAR_LEAD_CLASS),
        // so the row renders no slot span of its own.
        lead={null}
        ref={dropRef}
        // Focus anchor for the plain→drag subtree swap. Folder rows render
        // FIRST in the section, so the chevron is the first focusable thing a
        // Tab reaches — without this the very first Tab into Boards lands on
        // <body>. See `boards-nav-focus.ts`.
        data-folder-row={folder.id}
        data-testid={dropRef ? `folder-drop-${folder.id}` : undefined}
        className={cn(
          // `BoardFolderMenu` reveals on `group-hover/folder`, a different
          // group name from the primitive's own `group/row`.
          "group/folder",
          // The chevron below is a real 44px box on a coarse pointer; the row
          // has to be at least that tall or the button overflows it and eats
          // taps meant for the rows above and below.
          "pointer-coarse:min-h-11",
          isOver && "bg-state-hover ring-primary/60 text-foreground ring-1",
        )}
        trailing={
          <>
            {/* Decorative: a screen reader would otherwise announce a bare
                number with no unit after the folder name, and the expanded list
                of boards is right there. */}
            <span
              aria-hidden
              className="text-3xs text-muted-foreground mr-0.5 shrink-0 font-mono tabular-nums"
            >
              {count}
            </span>
            <BoardFolderMenu folder={folder} />
          </>
        }
      >
        {/* The chevron is the disclosure and nothing else. It keeps the same
            24px column the board rows reserve for their grip, so the header
            and its boards still line up, and it stays ONE rotated chevron
            rather than two swapped glyphs — a rotation animates, a swap
            cannot. It needs an explicit aria-label now that it no longer wraps
            the folder name: alone it would announce as an unnamed button. */}
        <button
          type="button"
          onClick={() => toggleSection(key)}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`Toggle ${folder.name}`}
          className={cn(
            SIDEBAR_LEAD_CLASS,
            "focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none",
            // Toggling used to be the whole row; it is a 24px glyph now, which
            // is under the 44px touch minimum on the iPad this app targets.
            // This used to be a `before:-inset-2.5` pseudo-element, but an
            // overlay is not clipped by the row: it spilled 10px above and
            // below into the NEIGHBOURING rows and swallowed their taps. A real
            // 44px box with a -10px margin on each side keeps the same 24px
            // LAYOUT footprint (44 − 2×10 = 24), so nothing shifts, while the
            // hit area stays inside this row — which `pointer-coarse:min-h-11`
            // on the row above makes tall enough to hold it.
            "pointer-coarse:-mx-2.5 pointer-coarse:size-11",
          )}
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "ease-keystone size-3.5 transition-transform duration-200",
              !open && "-rotate-90",
            )}
          />
        </button>
        {/* The name opens the folder's command center. The count and the ⋯
            menu stay OUTSIDE it — inside they would join its accessible name.
            The label metrics of `sidebarLabelClass(true)` are spelled out: the
            helper's `truncate` is dead on a flex container (the inner span
            does the truncating) and its `pl-1` belongs after the lead slot,
            which the chevron button above already occupies. */}
        <Link
          href={`/folders/${folder.id}`}
          className="focus-visible:ring-ring flex min-w-0 flex-1 items-center rounded py-1 pr-1 text-left text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
        >
          {open ? (
            <FolderOpen className="mr-1.5 size-3.5 shrink-0" aria-hidden />
          ) : (
            <Folder className="mr-1.5 size-3.5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        </Link>
      </SidebarRow>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-0.5 pl-3">
        {children}
      </div>
    </div>
  );
}
