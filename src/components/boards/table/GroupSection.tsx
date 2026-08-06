"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { withSubitems } from "@/lib/boards/item-tree";
import type { Column, Group, Item } from "@/lib/boards/queries";
import type { CacheCellValue } from "@/lib/boards/cache";
import { SummaryRow, hasAssignedSummary } from "@/components/boards/SummaryRow";
import { cn } from "@/lib/utils";
import { AddItemRow } from "./AddItemRow";
import { GroupHeaderRow } from "./GroupHeaderRow";
import { GroupRollupRow } from "./GroupRollupRow";
import { GroupSelectAllCheckbox } from "./GroupSelectAllCheckbox";
import { ItemRow } from "./ItemRow";
import { SubitemBlock } from "./SubitemBlock";
import {
  ROW_HEIGHT,
  type CellControls,
  type ColumnHeaderControls,
  type GroupSummaryControls,
} from "./shared";

// useLayoutEffect warns during SSR; this client component still pre-renders on
// the server, so fall back to useEffect there.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function GroupSection({
  group,
  groupIndex,
  items,
  columns,
  selectable,
  col,
  cellMap,
  template,
  controls,
  summary,
  onRenameGroup,
  nameWidth,
  autoFocusRename,
  onRenameSettled,
  onSetColor,
  onDelete,
  childrenByParent,
  expanded,
  onToggleExpand,
  renamingItemId,
  onRenameItemSettled,
  onSetRenamingItemId,
  scrollContainerRef,
  contentRef,
}: {
  group: Group;
  /** Zero-based position among visible groups — powers the Keystone head kicker. */
  groupIndex: number;
  items: Item[];
  columns: Column[];
  /** Whether bulk row-selection checkboxes are shown (editors only, not viewers). */
  selectable: boolean;
  col: ColumnHeaderControls;
  cellMap: Map<string, CacheCellValue["value"]>;
  template: string;
  controls: CellControls;
  summary: GroupSummaryControls;
  onRenameGroup: (name: string) => void;
  nameWidth: number;
  autoFocusRename: boolean;
  onRenameSettled: () => void;
  onSetColor: (color: string) => void;
  onDelete: () => void;
  childrenByParent: Map<string, Item[]>;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  renamingItemId: string | null;
  onRenameItemSettled: () => void;
  onSetRenamingItemId: (id: string) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [renaming, setRenaming] = useState(autoFocusRename);
  const [name, setName] = useState(group.name);
  const rowAreaRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // The shared scroll container is owned by the parent (BoardTable); during this
  // child's first commit the parent's ref isn't attached yet, so the virtualizer
  // reads a null scroll element and yields 0 rows. A passive effect populates the
  // ref, then flips `scrollReady` once to force a single extra render so the
  // virtualizer re-runs getScrollElement and binds the now-mounted container.
  // Value is intentionally unused — the state write forces one re-render so the
  // virtualizer re-runs getScrollElement once the parent ref is attached.
  const [scrollReady, setScrollReady] = useState(false);

  useEffect(() => {
    if (!scrollReady && scrollContainerRef.current) setScrollReady(true);
  }, [scrollReady, scrollContainerRef]);

  // The group's row-area offset within the shared scroll content. Re-measured
  // whenever the content height changes (any group expand/collapse/add/remove)
  // and on every render (covers DnD reorder, which shifts offsets without
  // changing total height). Guarded setState avoids a layout-effect loop.
  useIsoLayoutEffect(() => {
    const measure = () => {
      const area = rowAreaRef.current;
      const scroller = scrollContainerRef.current;
      if (!area || !scroller) return;
      const top =
        area.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      setScrollMargin((prev) => (prev === top ? prev : top));
    };
    measure();
    const content = contentRef.current;
    if (!content) return;
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => ro.disconnect();
  });

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id, data: { type: "group" } });

  // Container droppable for the whole group's row area — the board-level
  // collision strategy falls back to this when an item is dragged into a gap or
  // onto a collapsed group, so a drop here appends the item into this group.
  // Keyed distinctly from the group's sortable id so the two don't collide.
  const { setNodeRef: setGroupDropRef } = useDroppable({
    id: `group-drop-${group.id}`,
    data: { type: "group-container", groupId: group.id },
  });

  // React Compiler safely skips memoizing this component because useVirtualizer
  // returns non-memoizable functions; that fallback is correct here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    scrollMargin,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    // getBoundingClientRect().height returns 0 in jsdom — fall back to ROW_HEIGHT
    // so tests don't collapse all virtual rows to 0px height.
    measureElement: (el) => el.getBoundingClientRect().height || ROW_HEIGHT,
  });

  const virtualRows = virtualizer.getVirtualItems();

  function openRename() {
    setName(group.name);
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = name.trim();
    setRenaming(false);
    onRenameSettled();
    if (!trimmed || trimmed === group.name) return;
    onRenameGroup(trimmed);
  }

  return (
    // Translate only (no scale): CSS.Transform emits dnd-kit's scaleX/scaleY,
    // which — with variable-height groups — stretches the absolutely-positioned
    // virtual rows. Mirrors KanbanCard's translate3d-only drag transform.
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("mb-6", isDragging && "relative z-20 shadow-lg")}
    >
      <GroupHeaderRow
        group={group}
        groupIndex={groupIndex}
        columns={columns}
        template={template}
        selectAll={
          selectable && items.length > 0 ? (
            <GroupSelectAllCheckbox visibleIds={items.map((i) => i.id)} />
          ) : null
        }
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        renaming={renaming}
        name={name}
        onNameChange={setName}
        onCommitRename={commitRename}
        onCancelRename={() => {
          setRenaming(false);
          onRenameSettled();
        }}
        onOpenRename={openRename}
        itemCount={items.length}
        dragAttributes={attributes}
        dragListeners={listeners}
        onSetColor={onSetColor}
        onDelete={onDelete}
        col={col}
      />

      {/* Group body wrapper — the `group-container` droppable. Rendered for
          EVERY group regardless of item count / collapsed state, so even an
          empty group is a measurable append target (drop the first item into a
          freshly-created group). It sits BELOW the header, so it never overlaps
          the header's group-reorder hit area. Empty groups get a min-height so
          the rect is actually hittable; item rows inside are `type: "item"`
          droppables that win the collision first (see boardCollision), leaving
          this container as the gap/empty fallback that routes to append. */}
      <div
        ref={setGroupDropRef}
        style={items.length === 0 ? { minHeight: ROW_HEIGHT } : undefined}
      >
        {collapsed
          ? // Collapsed strip: the user's assigned aggregation wins; the legacy
            // hardcoded rollup remains the byte-for-byte fallback (spec D5).
            items.length > 0 &&
            (hasAssignedSummary(columns) ? (
              <SummaryRow
                variant="group"
                testId={`group-summary-${group.id}`}
                label="Group Summary"
                groupColor={group.color}
                columns={columns}
                itemIds={withSubitems(
                  items.map((i) => i.id),
                  childrenByParent,
                )}
                cellMap={cellMap}
                cache={controls.cache}
                template={template}
                nameWidth={nameWidth}
                canEdit={summary.canEdit}
                nowMs={summary.nowMs}
                onChange={summary.onChange}
              />
            ) : (
              <GroupRollupRow
                group={group}
                items={items}
                columns={columns}
                cellMap={cellMap}
                cache={controls.cache}
                template={template}
              />
            ))
          : null}

        {!collapsed && (
          <>
            {items.length > 0 && (
              // Item rows live under the single board-level DndContext (see
              // BoardTableInner) so rows can be dragged across groups; this
              // group keeps only its own SortableContext for in-group ordering.
              <SortableContext
                items={items.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <div
                  ref={rowAreaRef}
                  data-testid={`group-rows-${group.id}`}
                  className="relative"
                  style={{ height: virtualizer.getTotalSize() }}
                >
                  {virtualRows.map((vr) => {
                    const item = items[vr.index];
                    const children = childrenByParent.get(item.id) ?? [];
                    const isExpanded = expanded.has(item.id);
                    return (
                      <div
                        key={item.id}
                        data-index={vr.index}
                        ref={virtualizer.measureElement}
                        className="absolute top-0 left-0 w-full"
                        style={{
                          transform: `translateY(${vr.start - scrollMargin}px)`,
                        }}
                      >
                        <ItemRow
                          item={item}
                          columns={columns}
                          cellMap={cellMap}
                          template={template}
                          controls={controls}
                          selectable={selectable}
                          subitems={children}
                          childCount={children.length}
                          isExpanded={isExpanded}
                          onToggleExpand={onToggleExpand}
                          autoFocusRename={item.id === renamingItemId}
                          onRenameSettled={onRenameItemSettled}
                          onSubitemAdded={onSetRenamingItemId}
                        />
                        {isExpanded && children.length > 0 && (
                          <SubitemBlock
                            parentId={item.id}
                            subitems={children}
                            columns={columns}
                            cellMap={cellMap}
                            template={template}
                            controls={controls}
                            renamingItemId={renamingItemId}
                            onRenameSettled={onRenameItemSettled}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </SortableContext>
            )}
            {/* `summary.canEdit` IS the board's `access !== "viewer"` bit,
                built once in BoardTableInner and threaded down — reuse it
                rather than adding a second read-only notion that can drift. */}
            <AddItemRow
              groupId={group.id}
              controls={controls}
              nameWidth={nameWidth}
              canEdit={summary.canEdit}
            />
            {hasAssignedSummary(columns) && (
              <SummaryRow
                variant="group"
                testId={`group-summary-${group.id}`}
                label="Group Summary"
                groupColor={group.color}
                columns={columns}
                itemIds={withSubitems(
                  items.map((i) => i.id),
                  childrenByParent,
                )}
                cellMap={cellMap}
                cache={controls.cache}
                template={template}
                nameWidth={nameWidth}
                canEdit={summary.canEdit}
                nowMs={summary.nowMs}
                onChange={summary.onChange}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
