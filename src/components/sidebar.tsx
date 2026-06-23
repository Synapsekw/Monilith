"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  Gauge,
  Inbox,
  Target,
} from "lucide-react";
import { Brand } from "@/components/brand/brand";
import { BoardsNav } from "@/components/boards/BoardsNav";
import { DashboardsNav } from "@/components/dashboards/DashboardsNav";
import { PlatformNav } from "@/components/platform/PlatformNav";
import { WorkspaceNavItem } from "@/components/workspaces/WorkspaceNavItem";
import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";

const nav = [
  { label: "Goals", icon: Target, href: "/goals" },
  { label: "Portfolios", icon: BarChart3, href: "/portfolios" },
  { label: "Workload", icon: Gauge, href: "/workload" },
  { label: "Inbox", icon: Inbox },
] as const;

export function Sidebar({
  boards,
  sharedBoards,
  workspaces,
  dashboards,
  isPlatformAdmin,
  isOrgAdmin,
}: {
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
  workspaces: { id: string; name: string }[];
  dashboards: { id: string; name: string }[];
  isPlatformAdmin?: boolean;
  isOrgAdmin?: boolean;
}) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const pathname = usePathname();

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
          hasHydrated && "transition-[width] duration-200 ease-out",
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

        <BoardsNav
          boards={boards}
          sharedBoards={sharedBoards}
          workspaces={workspaces}
          collapsed={isCollapsed}
        />

        {!isCollapsed ? <Separator className="mx-3 my-1 w-auto" /> : null}

        <DashboardsNav
          dashboards={dashboards}
          workspaces={workspaces}
          collapsed={isCollapsed}
        />

        {!isCollapsed ? <Separator className="mx-3 my-1 w-auto" /> : null}

        <nav
          className={cn(
            "flex flex-col gap-0.5 py-2",
            isCollapsed ? "items-center px-2" : "px-2",
          )}
        >
          {nav.map((item) => {
            const href = "href" in item ? item.href : undefined;
            const isActive =
              !!href && (pathname === href || pathname.startsWith(`${href}/`));
            if (isCollapsed) {
              return (
                <Tooltip key={item.label}>
                  <TooltipTrigger asChild>
                    {href ? (
                      <Link
                        href={href}
                        aria-label={item.label}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "flex size-9 items-center justify-center rounded-md transition-colors",
                          isActive
                            ? "bg-primary/80 text-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <item.icon className="size-4" />
                      </Link>
                    ) : (
                      <button
                        type="button"
                        disabled
                        aria-label={item.label}
                        className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-9 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <item.icon className="size-4" />
                      </button>
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }
            return href ? (
              <Link
                key={item.label}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary/80 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                disabled
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                <item.icon className="size-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {!isCollapsed ? <Separator className="mx-3 my-1 w-auto" /> : null}

        {!isCollapsed && workspaces.length > 0 ? (
          <div className="mt-2 flex flex-col gap-0.5 px-2">
            <div className="flex items-center px-3 py-1">
              <p className="text-muted-foreground text-xs font-medium">
                Workspaces
              </p>
              <NewWorkspaceDialog />
            </div>
            {workspaces.map((workspace) => (
              <WorkspaceNavItem
                key={workspace.id}
                workspace={workspace}
                isOrgAdmin={!!isOrgAdmin}
                isLast={workspaces.length <= 1}
              />
            ))}
          </div>
        ) : null}

        <div className="mt-auto">
          <PlatformNav
            isPlatformAdmin={isPlatformAdmin}
            collapsed={isCollapsed}
          />
        </div>
      </aside>
    </TooltipProvider>
  );
}
