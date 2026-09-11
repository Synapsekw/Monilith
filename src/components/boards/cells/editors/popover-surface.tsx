"use client";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

/**
 * A floating popover surface for selector editors (Status/Dropdown/People).
 * Built on Radix Popover so it portals to the body — escaping the board's
 * `overflow-auto` scroll containers — and flips/shifts to stay on screen, so
 * every option is reachable however near the viewport edge the cell sits
 * (Monday-style). Monochrome chrome; color is earned only by the pills inside.
 *
 * `--radix-popover-content-available-height` caps the surface to the space the
 * collision detector measured, and the inner list scrolls beyond that.
 */
export function PopoverSurface({
  label,
  onCancel,
  children,
}: {
  label: string;
  /** Fired when the popover is dismissed (Escape or outside click). */
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <Popover
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {/* Anchors the floating surface to the cell it edits. */}
      <PopoverAnchor className="absolute inset-0" aria-hidden />
      <PopoverContent
        role="listbox"
        aria-label={label}
        align="start"
        sideOffset={4}
        className="flex max-h-[min(20rem,var(--radix-popover-content-available-height))] min-w-[12rem] flex-col gap-0.5 overflow-auto p-1"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
