"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Gauge, Inbox, Target } from "lucide-react";
import { BoardsNav } from "@/components/boards/BoardsNav";
import { DashboardsNav } from "@/components/dashboards/DashboardsNav";
import { PlatformNav } from "@/components/platform/PlatformNav";
import { WorkspaceNavItem } from "@/components/workspaces/WorkspaceNavItem";
import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
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

/**
 * Client renderer for the per-user sidebar nav body. Fed resolved data by the
 * streamed server component `SidebarNavData`; reads the persisted collapse flag
 * from the UI store so collapsed/expanded markup matches the surrounding
 * `Sidebar` frame. Mirrors the DOM order of the original sidebar verbatim.
 */
export function SidebarNav({
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
  const isCollapsed = hasHydrated && collapsed;
  const pathname = usePathname();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
    </div>
  );
}
