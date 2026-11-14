"use client";

import { clampDragWidth, NAME_COL_MAX } from "@/lib/boards/name-column-width";
import { useRafThrottle } from "@/lib/hooks/use-raf-callback";

const NAME_DRAG_MIN = 80; // manual drag floor (matches ColumnHeader MIN)

/**
 * Header for the built-in Name column: a sticky "Name" label plus a right-edge
 * resize handle that mirrors {@link ColumnHeader}. Drag resizes live (0 server
 * round-trips) and persists the px width on release; double-clicking the handle
 * clears the manual width so the column returns to auto-fit.
 */
/**
 * The Name-column resize separator (drag to resize, double-click to auto-fit).
 * Lives on the right edge of each group header's frozen Name cell. Extracted
 * from the old global header's NameColumnHeader so every group can resize the
 * shared Name column.
 */
export function NameResizeHandle({
  width,
  onResize,
  onResizeEnd,
  onAutoFit,
  onResizeCancel,
  min = NAME_DRAG_MIN,
  max = NAME_COL_MAX,
  label = "Resize Name column (double-click to auto-fit)",
}: {
  width: number;
  onResize: (w: number) => void;
  onResizeEnd: (w: number) => void;
  onAutoFit: () => void;
  /** The browser took the gesture (e.g. for scrolling): nothing is committed;
   * the caller drops any live width. */
  onResizeCancel?: () => void;
  /** Drag clamp. Defaults are the table Name column's bounds. */
  min?: number;
  max?: number;
  /** Accessible name. The default is the table Name column's. */
  label?: string;
}) {
  // Coalesce per-pixel live-width updates to one state update per frame so the
  // drag stays smooth; the persist-on-release path (onResizeEnd) is unchanged.
  const [throttledResize, cancelThrottledResize] = useRafThrottle(onResize);

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let last = width;
    const move = (ev: PointerEvent) => {
      last = clampDragWidth(startW + (ev.clientX - startX), min, max);
      throttledResize(last);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    const cancel = () => {
      cleanup();
      cancelThrottledResize();
      onResizeCancel?.();
    };
    const up = () => {
      cleanup();
      // Drop a still-pending live frame: it would land after onResizeEnd and
      // re-pin the live width the release handler just cleared.
      cancelThrottledResize();
      onResizeEnd(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
      onDoubleClick={onAutoFit}
      className="hover:bg-primary/40 absolute top-0 right-0 h-full w-1 cursor-col-resize touch-none"
    />
  );
}
