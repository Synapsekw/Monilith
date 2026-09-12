"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  CardSeam,
  SEAM_CAP,
  seamHitClasses,
} from "@/components/shell/card-seam";
import { cn } from "@/lib/utils";
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH } from "./use-dock-state";

/**
 * A pointer that moved further than this, or stayed down longer, was a resize
 * and must never also fold the dock. Generous enough that a hand resting on a
 * trackpad still reads as a click, tight enough that a real drag never does.
 */
const CLICK_SLOP = 4;
const CLICK_MS = 400;

/**
 * The dock's edge: one seam that folds on click and resizes on drag.
 *
 * The card's right hairline was already the dock's resize grip. Rather than
 * stack a second control on a 4px gutter, the two are the same object — which
 * is also why the outer element keeps `role="separator"` with its value range
 * (that is the richer contract, and the one arrow keys answer to) and the
 * visible cap is a real `<button>` nested inside it. Assistive tech gets both:
 * a resizable separator, and a labelled control that folds.
 *
 * It is PORTALLED into the shell's `#card-seam-slot`, the same way the dock
 * itself portals into `#app-dock-slot`: the seam belongs to the content card's
 * outline, which lives in the static shell, while the state it drives belongs
 * to this board's dock.
 */
export function DockSeam({
  open,
  width,
  onToggle,
  onResizeStart,
  onResizeStep,
}: {
  open: boolean;
  /** The width being shown right now — mid-drag that is the drag width. */
  width: number;
  onToggle: (next: boolean) => void;
  onResizeStart: (e: React.PointerEvent<HTMLElement>) => void;
  /** Positive widens the dock, matching the drag direction (leftwards). */
  onResizeStep: (delta: number) => void;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // A post-mount DOM lookup is the one correct time to find a portal target;
    // the static shell sits above this page in the tree, so the slot exists by
    // the time effects run.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlot(document.getElementById("card-seam-slot"));
  }, []);

  /** Set by a pointer that travelled: the click it produces is not a fold. */
  const dragged = useRef(false);

  if (!slot) return null;

  return createPortal(
    <CardSeam side="right" className="max-md:hidden">
      {/* A CLOSED dock has no width to drag, so the strip claims no separator
          role and no tab stop there — it would announce a value range that
          cannot be changed. Closed, it is a mouse convenience over the cap
          button, which carries every semantic either way. */}
      <div
        role={open ? "separator" : undefined}
        aria-orientation={open ? "vertical" : undefined}
        aria-label={open ? "Resize agent dock" : undefined}
        aria-valuenow={open ? width : undefined}
        aria-valuemin={open ? DOCK_MIN_WIDTH : undefined}
        aria-valuemax={open ? DOCK_MAX_WIDTH : undefined}
        tabIndex={open ? 0 : undefined}
        className={cn(
          seamHitClasses("right"),
          // Only an open dock has a width to drag; a closed one is a button.
          open && "cursor-col-resize touch-none",
        )}
        onPointerDown={(e) => {
          dragged.current = false;
          if (!open) return;
          const startX = e.clientX;
          const startedAt = Date.now();
          const settle = (ev: PointerEvent) => {
            if (
              Math.abs(ev.clientX - startX) > CLICK_SLOP ||
              Date.now() - startedAt > CLICK_MS
            ) {
              dragged.current = true;
            }
            window.removeEventListener("pointerup", settle);
          };
          window.addEventListener("pointerup", settle);
          onResizeStart(e);
        }}
        onClick={() => {
          // The cap button stops its own clicks, so anything arriving here came
          // from the strip itself.
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          onToggle(!open);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onResizeStep(1);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onResizeStep(-1);
          }
        }}
      >
        <button
          type="button"
          data-dock-seam-toggle
          aria-label={open ? "Close agent dock" : "Open agent dock"}
          aria-expanded={open}
          onClick={(e) => {
            // Without this the separator's own handler folds it straight back.
            e.stopPropagation();
            onToggle(!open);
          }}
          className={cn(
            SEAM_CAP,
            "focus-visible:ring-ring cursor-pointer focus-visible:ring-2 focus-visible:outline-none",
          )}
        >
          {open ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <ChevronLeft className="size-3.5" />
          )}
        </button>
      </div>
    </CardSeam>,
    slot,
  );
}
