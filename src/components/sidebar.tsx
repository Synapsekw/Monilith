"use client";

import { useEffect, type ReactNode } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { Brand } from "@/components/brand/brand";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";

/**
 * Static sidebar frame: brand + collapse toggle + a `navSlot` for the streamed
 * per-user nav (boards/dashboards/workspaces/platform). The frame is part of the
 * prerendered shell; the slot is Suspense-wrapped by the caller and streams in.
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
          "bg-sidebar hidden shrink-0 flex-col border-r md:flex",
          hasHydrated && "ease-keystone transition-[width] duration-200",
          isCollapsed ? "w-14" : "w-60",
        )}
      >
        <div
          className={cn(
            "flex min-h-14 gap-1 px-3 py-2",
            isCollapsed
              ? "flex-col items-center px-0"
              : "items-center justify-between",
          )}
        >
          <Brand collapsed={isCollapsed} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!isCollapsed}
                onClick={toggleSidebar}
                className="text-muted-foreground hover:text-foreground size-8 shrink-0"
              >
                {isCollapsed ? (
                  <ChevronsRight className="size-4" />
                ) : (
                  <ChevronsLeft className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isCollapsed ? "Expand sidebar" : "Collapse sidebar"} (⌘\)
            </TooltipContent>
          </Tooltip>
        </div>

        {navSlot}
      </aside>
    </TooltipProvider>
  );
}
