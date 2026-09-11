"use client";

import { type ReactNode } from "react";
import { ChevronDown, Folder, FolderOpen } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { BoardFolderMenu } from "@/components/boards/BoardFolderMenu";
import {
  SIDEBAR_LEAD_CLASS,
  SidebarRow,
  sidebarLabelClass,
} from "@/components/shell/sidebar-row";

/**
 * One collapsible folder in the Boards nav. Open/closed state reuses
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
        // The disclosure button spans the lead slot AND the label, so the row
        // itself renders no slot span — the button's own chevron span is it.
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
        {/* ONE disclosure, not two. The chevron and the name used to be
            separate buttons doing the identical thing, which cost the folder a
            third tab stop for no second control. The accessible name is the
            folder name and `aria-expanded` carries the state — the standard
            disclosure pattern, and a screen reader already announces
            "Acme Rebrand, button, collapsed" without a redundant aria-label.
            The count and the ⋯ menu stay OUTSIDE: inside they would join the
            accessible name. */}
        <button
          type="button"
          onClick={() => toggleSection(key)}
          aria-expanded={open}
          aria-controls={bodyId}
          className={cn(
            "focus-visible:ring-ring flex min-w-0 flex-1 items-center rounded text-left focus-visible:ring-2 focus-visible:outline-none",
            sidebarLabelClass(true),
            // The label's `pl-1` belongs AFTER the lead slot; here the slot is
            // inside the button, so the button itself starts flush.
            "pl-0",
          )}
        >
          {/* Keeps the chevron in the same 24px column the board rows reserve
              for their grip, so the header and its boards line up. One rotated
              chevron, not two glyphs — the rotation animates, a swap cannot. */}
          <span aria-hidden className={SIDEBAR_LEAD_CLASS}>
            <ChevronDown
              className={cn(
                "ease-keystone size-3.5 transition-transform duration-200",
                !open && "-rotate-90",
              )}
            />
          </span>
          {open ? (
            <FolderOpen className="mr-1.5 size-3.5 shrink-0" aria-hidden />
          ) : (
            <Folder className="mr-1.5 size-3.5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        </button>
      </SidebarRow>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-0.5 pl-3">
        {children}
      </div>
    </div>
  );
}
