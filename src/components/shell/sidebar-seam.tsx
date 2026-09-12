"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { CardSeam, SEAM_CAP, seamHitClasses } from "./card-seam";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";

/**
 * The sidebar's collapse control: the card's left hairline.
 *
 * It replaced the chevron that used to sit in the brand row. That one was far
 * from the edge it moved, asymmetric with the dock's own control, and stacked
 * awkwardly under the mark once the rail was 56px wide. This one is on the seam
 * it operates, and reads as the card's own edge rather than added chrome.
 *
 * Hidden below `md`, where there is no rail to fold — the mobile nav is a
 * drawer off the header.
 */
export function SidebarSeam() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  // Same SSR-safe default the rail itself renders: expanded until the persisted
  // value has rehydrated, so the label never contradicts what is on screen.
  const isCollapsed = hasHydrated && collapsed;

  return (
    <CardSeam side="left" className="max-md:hidden">
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!isCollapsed}
        title={`${isCollapsed ? "Expand" : "Collapse"} sidebar (⌘\\)`}
        className={seamHitClasses("left")}
      >
        <span
          className={cn(
            SEAM_CAP,
            "group-focus-visible/hit:ring-ring group-focus-visible/hit:ring-2",
          )}
        >
          {isCollapsed ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <ChevronLeft className="size-3.5" />
          )}
        </span>
      </button>
    </CardSeam>
  );
}
