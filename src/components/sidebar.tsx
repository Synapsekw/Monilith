"use client";

import { useEffect, type ReactNode } from "react";
import { Brand } from "@/components/brand/brand";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";

/**
 * Static sidebar frame: brand + a `navSlot` for the streamed per-user nav
 * (boards/dashboards/workspaces/platform). The frame is part of the prerendered
 * shell; the slot is Suspense-wrapped by the caller and streams in.
 *
 * The rail owns the ⌘\ shortcut but not a visible toggle: the collapse control
 * is the card's left seam (`SidebarSeam`), mounted by the shell.
 */
export function Sidebar({ navSlot }: { navSlot: ReactNode }) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  // Render the SSR-safe default (expanded) until the persisted value hydrates,
  // and only animate width afterwards so there's no first-paint jump.
  const isCollapsed = hasHydrated && collapsed;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        data-collapsed={isCollapsed}
        className={cn(
          "hidden shrink-0 flex-col overflow-hidden md:flex",
          hasHydrated && "ease-keystone transition-[width] duration-200",
          isCollapsed ? "w-14" : "w-60",
        )}
      >
        {/* Brand alone. The collapse chevron that used to sit here moved to the
            seam it actually operates — `SidebarSeam`, on the card's left edge —
            so the row no longer has to reflow into a two-item column at 56px. */}
        <div
          className={cn(
            "flex min-h-14 items-center gap-1 px-3 py-2",
            isCollapsed && "justify-center px-0",
          )}
        >
          <Brand collapsed={isCollapsed} />
        </div>

        {navSlot}
      </aside>
    </TooltipProvider>
  );
}
