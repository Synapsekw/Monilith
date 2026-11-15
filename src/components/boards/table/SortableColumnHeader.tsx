"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Column } from "@/lib/boards/queries";
import { ColumnHeader } from "@/components/boards/ColumnHeader";
import { resolveColumnWidth, type ColumnHeaderControls } from "./shared";

/** Owns useSortable for one data-column header so ColumnHeader stays
 *  presentational. Translate-only transform (gotcha-20: grid tracks have
 *  differing widths — never stretch). */
export function SortableColumnHeader({
  column,
  col,
  onMoveLeft,
  onMoveRight,
}: {
  column: Column;
  col: ColumnHeaderControls;
  onMoveLeft: (() => void) | null;
  onMoveRight: (() => void) | null;
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });
  return (
    <ColumnHeader
      column={column}
      width={resolveColumnWidth(column, col.liveWidths, col.autoFitWidths)}
      onRename={(n) => col.renameColumn(column.id, n)}
      onDelete={() => col.deleteColumn(column.id)}
      onResize={(w) => col.setLiveWidths((m) => ({ ...m, [column.id]: w }))}
      onResizeEnd={(w) => col.resizeColumn(column.id, w)}
      onAutoFit={() => {
        // Drop the live width too. It is set during a drag and never cleared
        // afterwards, so it would keep masking the (now null) saved width.
        col.setLiveWidths((m) => {
          if (!(column.id in m)) return m;
          const next = { ...m };
          delete next[column.id];
          return next;
        });
        col.resizeColumn(column.id, null);
      }}
      onEditOptions={() => col.onEditOptions(column)}
      onEditCurrency={() => col.onEditCurrency(column)}
      onSmartFill={() => col.onSmartFill(column)}
      reorder={{
        setNodeRef,
        style: {
          transform: CSS.Translate.toString(transform),
          transition,
        },
        isDragging,
        handleAttributes: attributes,
        handleListeners: listeners,
        onMoveLeft,
        onMoveRight,
      }}
    />
  );
}
