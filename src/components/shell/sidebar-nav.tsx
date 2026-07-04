"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Clock, Gauge, Inbox, Target } from "lucide-react";
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
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import { cn } from "@/lib/utils";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";

/**
 * Visible caption for a collapsed icon-only rail item under a coarse pointer.
 * Closes gotcha-47: the touch-suppressed tooltip can no longer be the item's
 * only label. The text equals the trigger's `aria-label` (single source) and is
 * `truncate`d so a long name never widens the fixed `w-14` rail.
 */
function CoarseCaption({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground max-w-full truncate text-[10px] leading-tight">
      {label}
    </span>
  );
}

const nav = [
  { label: "Goals", icon: Target, href: "/goals" },
  { label: "Portfolios", icon: BarChart3, href: "/portfolios" },
  { label: "Workload", icon: Gauge, href: "/workload" },
  { label: "My Time", icon: Clock, href: "/time" },
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
  newFeedbackCount,
  forceExpanded = false,
}: {
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
  workspaces: { id: string; name: string }[];
  dashboards: { id: string; name: string }[];
  isPlatformAdmin?: boolean;
  isOrgAdmin?: boolean;
  newFeedbackCount?: number;
  /**
   * Render always-expanded, ignoring the persisted collapse flag. Used by the
   * mobile drawer, which is full-width and never shows the icon-only rail.
   */
  forceExpanded?: boolean;
}) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const isCollapsed = !forceExpanded && hasHydrated && collapsed;
  const coarse = useCoarsePointer();
  const pathname = usePathname();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BoardsNav
        boards={boards}
        sharedBoards={sharedBoards}
        workspaces={workspaces}
        collapsed={isCollapsed}
      />

      {!isCollapsed ? (
        <Separator className="mx-3 my-1 data-horizontal:w-auto" />
      ) : null}

      <DashboardsNav
        dashboards={dashboards}
        workspaces={workspaces}
        collapsed={isCollapsed}
      />

      {!isCollapsed ? (
        <Separator className="mx-3 my-1 data-horizontal:w-auto" />
      ) : null}

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
            // Collapsed rail item: icon, plus a visible caption stacked beneath
            // it on a coarse pointer (gotcha-47) so touch/keyboard users get an
            // on-screen label. `min-h-11`/`min-w-11` (44px, Apple HIG) only on
            // coarse — desktop keeps the compact `size-9`.
            const collapsedItemCn = cn(
              "flex w-full max-w-full flex-col items-center justify-center gap-0.5 rounded-md transition-colors",
              "size-9 pointer-coarse:size-auto pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-1 pointer-coarse:py-1.5",
              isActive
                ? "bg-primary/80 text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            );
            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  {href ? (
                    <Link
                      href={href}
                      aria-label={item.label}
                      aria-current={isActive ? "page" : undefined}
                      className={collapsedItemCn}
                    >
                      <item.icon className="size-4 shrink-0" />
                      {coarse ? <CoarseCaption label={item.label} /> : null}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled
                      aria-label={item.label}
                      className={cn(
                        collapsedItemCn,
                        "disabled:cursor-not-allowed disabled:opacity-60",
                      )}
                    >
                      <item.icon className="size-4 shrink-0" />
                      {coarse ? <CoarseCaption label={item.label} /> : null}
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

      {!isCollapsed ? (
        <Separator className="mx-3 my-1 data-horizontal:w-auto" />
      ) : null}

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

      <div className="mt-auto pb-4">
        <PlatformNav
          isPlatformAdmin={isPlatformAdmin}
          collapsed={isCollapsed}
          newCount={newFeedbackCount}
        />
      </div>
    </div>
  );
}
