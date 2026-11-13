import { cn } from "@/lib/utils";

/**
 * A tiny drawing of the panel an edge nub controls: a window outline, the
 * divider, and a fill bar where the panel sits. Folding the panel empties the
 * bar (`.panel-glyph-bar` in globals.css), so the icon says "this panel, open
 * or folded" rather than pointing a direction. A chevron did the latter, read
 * as back/forward, and flipped meaning every time the panel did.
 *
 * Decorative: the button around it carries the accessible name.
 */
export function PanelGlyph({
  side,
  open,
  className,
}: {
  side: "left" | "right";
  open: boolean;
  className?: string;
}) {
  const divider = side === "left" ? 9.5 : 14.5;
  const barX = side === "left" ? 4.5 : 14.5;
  return (
    <svg
      aria-hidden="true"
      data-panel-glyph={side}
      data-state={open ? "open" : "closed"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinejoin="round"
      className={cn("panel-glyph size-3.5", className)}
    >
      <rect x="3" y="4" width="18" height="16" rx="3.5" />
      <path d={`M${divider} 4v16`} />
      <rect
        data-panel-bar
        className="panel-glyph-bar"
        x={barX}
        y="5.5"
        width="5"
        height="13"
        rx="1.6"
        fill="currentColor"
        stroke="none"
        style={{ transformOrigin: side === "left" ? "left" : "right" }}
      />
    </svg>
  );
}
