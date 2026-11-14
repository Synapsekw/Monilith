"use client";

import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import type { useSortable } from "@dnd-kit/sortable";
import type { Group } from "@/lib/boards/queries";
import type { GroupProgress } from "@/lib/boards/group-progress";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { GroupMenu } from "./GroupMenu";

/**
 * A group's row: a 30px divider that spans the table (44px on coarse
 * pointers). It is NOT a grid on the column template any more — the board's
 * columns live in the single {@link BoardColumnHeader}.
 *
 * Sticky twice:
 *  - the row is `sticky top-[30px]` (the column header's height) inside its
 *    own <section>, so the current group's title stays pinned under the
 *    column header while its rows scroll, and the next group pushes it out;
 *  - its content sits in an inner block that is `sticky left-0` and exactly as
 *    wide as the VISIBLE scroller (`--board-viewport-w`, published by
 *    BoardTableInner), so the title, count, meter and menu stay in view
 *    during horizontal scroll.
 *
 * Stacking: `z-30` — above every row, the frozen Name cells (z-10) and the row
 * hairlines (z-20); below the column header (z-40).
 *
 * The title is the group's name as the user typed it, in Inter at the
 * `text-group` size. No mono kicker, no index number, same tone for every
 * group.
 */
export function GroupHeaderRow({
  group,
  selectAll,
  collapsed,
  onToggleCollapse,
  renaming,
  name,
  onNameChange,
  onCommitRename,
  onCancelRename,
  onOpenRename,
  itemCount,
  progress,
  dragAttributes,
  dragListeners,
  onSetColor,
  onDelete,
}: {
  group: Group;
  /** Group "select all visible" checkbox, or null for viewers/empty groups. */
  selectAll: React.ReactNode;
  collapsed: boolean;
  onToggleCollapse: () => void;
  renaming: boolean;
  name: string;
  onNameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onOpenRename: () => void;
  itemCount: number;
  /** Done-rule progress over the group's visible rows; null = no meter. */
  progress: GroupProgress | null;
  dragAttributes: ReturnType<typeof useSortable>["attributes"];
  dragListeners: ReturnType<typeof useSortable>["listeners"];
  onSetColor: (color: string) => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-testid={`group-header-${group.id}`}
      // Theme-reactive surface: 8% of the preset's brand mixed into the raised
      // surface (Board Total uses 14%, so the two read as one family with the
      // total heavier). Opaque on purpose, never an alpha tint: this row is
      // sticky and rows scroll beneath it.
      className="group/grouphdr sticky top-[30px] z-30 flex h-[30px] w-full items-center bg-[color-mix(in_srgb,var(--color-brand)_8%,var(--color-surface))] pointer-coarse:top-11 pointer-coarse:h-11"
    >
      <div className="sticky left-0 flex h-full w-[var(--board-viewport-w,100%)] min-w-0 items-center gap-1.5 px-2">
        {selectAll}
        <button
          type="button"
          aria-label={`Reorder ${group.name}`}
          {...dragAttributes}
          {...dragListeners}
          className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded-md opacity-0 transition-opacity group-hover/grouphdr:opacity-100 active:cursor-grabbing pointer-coarse:size-11 pointer-coarse:opacity-100"
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.name}`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring grid size-6 shrink-0 place-items-center rounded-md focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11"
        >
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>
        {/* Group colour, right next to the name it labels. */}
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: group.color }}
        />
        {renaming ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelRename();
              }
            }}
            aria-label={`Rename ${group.name}`}
            className="h-6 max-w-xs px-1.5 pointer-coarse:h-11"
          />
        ) : (
          <button
            type="button"
            onClick={onOpenRename}
            aria-label={group.name}
            // `text-group` stays OUT of cn(): tailwind-merge 3.6 treats custom
            // `--text-*` size tokens as text COLORS and would drop
            // `text-foreground` (see text-size-token-cn-merge.test.ts).
            className={`text-group ${cn(
              "text-foreground focus-visible:ring-ring min-w-0 truncate rounded-sm text-left font-semibold focus-visible:ring-2 focus-visible:outline-none",
            )}`}
          >
            {group.name}
          </button>
        )}
        <span className="bg-surface-muted text-muted-foreground text-2xs shrink-0 rounded-sm px-1.5 py-px tabular-nums">
          {itemCount}
        </span>
        {progress ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              role="progressbar"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${group.name}: ${progress.done} of ${progress.total} done`}
              className="bg-foreground/[0.07] relative h-1 w-16 overflow-hidden rounded-full"
            >
              {/* Progress fill: one of the four sanctioned uses of the brand
                  gradient (pulse-ui → "Second accent and the brand gradient"). */}
              <span
                className="bg-brand-gradient absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${progress.percent}%` }}
              />
            </span>
            <span className="text-muted-foreground text-2xs tabular-nums">
              {progress.percent}% done
            </span>
          </span>
        ) : null}
        <GroupMenu
          group={group}
          onRename={onOpenRename}
          onSetColor={onSetColor}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
