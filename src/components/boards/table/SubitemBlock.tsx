"use client";

import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import { reorderPosition } from "@/lib/boards/group-reorder";
import type { Column, Item } from "@/lib/boards/queries";
import type { CacheCellValue } from "@/lib/boards/cache";
import { AddSubitemRow } from "./AddSubitemRow";
import { SortableSubitemRow } from "./SortableSubitemRow";
import type { CellControls } from "./shared";

/** An indented block of subitems rendered below their expanded parent. */
export function SubitemBlock({
  parentId,
  subitems,
  columns,
  cellMap,
  template,
  controls,
  renamingItemId,
  onRenameSettled,
}: {
  parentId: string;
  subitems: Item[];
  columns: Column[];
  cellMap: Map<string, CacheCellValue["value"]>;
  template: string;
  controls: CellControls;
  renamingItemId: string | null;
  onRenameSettled: () => void;
}) {
  const subitemSensors = useTouchAwareSensors();

  function handleSubitemDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const position = reorderPosition(
      subitems.map((s) => ({ id: s.id, position: s.position })),
      String(active.id),
      String(over.id),
    );
    if (position !== null) controls.reorderItem(String(active.id), position);
  }

  return (
    // Recessed band so the nested subitems read as visually distinct from
    // top-level item rows and the parent-level "Add item" row below them.
    <div className="bg-surface-sunken">
      <DndContext
        id={`subitems-${parentId}`}
        sensors={subitemSensors}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleSubitemDragEnd}
      >
        <SortableContext
          items={subitems.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {subitems.map((sub) => (
            <SortableSubitemRow
              key={sub.id}
              sub={sub}
              columns={columns}
              cellMap={cellMap}
              template={template}
              controls={controls}
              renamingItemId={renamingItemId}
              onRenameSettled={onRenameSettled}
            />
          ))}
        </SortableContext>
      </DndContext>
      <AddSubitemRow parentId={parentId} controls={controls} />
    </div>
  );
}
