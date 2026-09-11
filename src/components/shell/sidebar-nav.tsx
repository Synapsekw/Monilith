"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Clock,
  FileText,
  Gauge,
  ListTodo,
  Target,
  Trash2,
} from "lucide-react";
import type { ComponentType } from "react";
import { AskAiMark } from "@/components/brand/ask-ai-mark";
import { BoardsNav } from "@/components/boards/BoardsNav";
import { DashboardsNav } from "@/components/dashboards/DashboardsNav";
import { ContextSwitcher } from "@/components/shell/context-switcher";
import { NavSection } from "@/components/shell/nav-section";
import {
  RailDivider,
  SidebarLink,
  railTileClass,
} from "@/components/shell/sidebar-row";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUIStore } from "@/stores/ui";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";
import type {
  BoardFolder,
  BoardFolderPlacement,
} from "@/lib/boards/folders/types";

type NavLink = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

const TOP: NavLink[] = [
  { label: "My Work", href: "/my-work", icon: ListTodo },
  { label: "Agents", href: "/ask", icon: AskAiMark },
];
const PLANNING: NavLink[] = [
  { label: "Goals", href: "/goals", icon: Target },
  { label: "Portfolios", href: "/portfolios", icon: BarChart3 },
  { label: "Reports", href: "/reports", icon: FileText },
  { label: "Workload", href: "/workload", icon: Gauge },
];
const FOOTER: NavLink[] = [
  { label: "My Time", href: "/time", icon: Clock },
  { label: "Trash", href: "/boards#archived", icon: Trash2 },
];

/** Visible caption under a collapsed rail tile on a coarse pointer (gotcha-47). */
function CoarseCaption({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground text-3xs max-w-full truncate leading-tight">
      {label}
    </span>
  );
}

function useActive() {
  const pathname = usePathname();
  // Unchanged from today: "/boards#archived" never prefix-matches a board page.
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/** Collapsed icon-only rail link (tooltip + coarse caption). */
function RailLink({
  item,
  active,
  coarse,
}: {
  item: NavLink;
  active: boolean;
  coarse: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          aria-label={item.label}
          aria-current={active ? "page" : undefined}
          className={railTileClass({ active })}
        >
          <item.icon className="size-4 shrink-0" />
          {coarse ? <CoarseCaption label={item.label} /> : null}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Keystone sidebar body. Order: context chip → My Work / Agents → Planning →
 * Boards → Dashboards, all inside ONE scroll region, then a pinned footer with
 * My Time + Trash. No separators: the ledger rules + 14px section rhythm are
 * the structure. Platform admin lives in the header, not here.
 */
export function SidebarNav({
  orgs = [],
  activeOrgId = "",
  boards,
  sharedBoards,
  folders,
  placements,
  workspaces,
  activeWorkspaceId = "",
  dashboards,
  forceExpanded = false,
}: {
  orgs?: { id: string; name: string }[];
  activeOrgId?: string;
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
  /** Private board folders for the signed-in user (optional so every existing
   *  call site — and the folder-blind tests — stay valid). */
  folders?: BoardFolder[];
  placements?: BoardFolderPlacement[];
  workspaces: { id: string; name: string }[];
  activeWorkspaceId?: string;
  dashboards: { id: string; name: string }[];
  forceExpanded?: boolean;
}) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const isCollapsed = !forceExpanded && hasHydrated && collapsed;
  const coarse = useCoarsePointer();
  const isActive = useActive();

  const boardsNav = (
    <BoardsNav
      boards={boards}
      sharedBoards={sharedBoards}
      folders={folders}
      placements={placements}
      activeWorkspaceId={activeWorkspaceId}
      collapsed={isCollapsed}
    />
  );
  const dashboardsNav = (
    <DashboardsNav
      dashboards={dashboards}
      activeWorkspaceId={activeWorkspaceId}
      collapsed={isCollapsed}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ContextSwitcher
        orgs={orgs}
        activeOrgId={activeOrgId}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        collapsed={isCollapsed}
      />

      {/* `data-scroll-container` reserves a stable 10px scrollbar gutter
          (globals.css). The 56px rail cannot spare it — the squeeze clipped the
          active edge bar and pushed rail tiles to three different widths — so
          only the expanded body opts in. */}
      <div
        data-testid="sidebar-scroll"
        data-scroll-container={isCollapsed ? undefined : ""}
        className="nav-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
      >
        {isCollapsed ? (
          <>
            <nav className="flex flex-col items-center gap-0.5 px-2 pt-2">
              <RailDivider />
              {TOP.map((item) => (
                <RailLink
                  key={item.href}
                  item={item}
                  active={isActive(item.href)}
                  coarse={coarse}
                />
              ))}
              <RailDivider />
              {PLANNING.map((item) => (
                <RailLink
                  key={item.href}
                  item={item}
                  active={isActive(item.href)}
                  coarse={coarse}
                />
              ))}
              <RailDivider />
              {boardsNav}
              <RailDivider />
              {dashboardsNav}
            </nav>
            <div
              data-scroll-spacer=""
              className="h-3.5 shrink-0"
              aria-hidden="true"
            />
          </>
        ) : (
          <>
            <nav className="flex flex-col gap-0.5 px-2 pt-2.5">
              {TOP.map((item) => (
                <SidebarLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={isActive(item.href)}
                />
              ))}
            </nav>
            <NavSection storageKey="planning" title="Planning">
              {PLANNING.map((item) => (
                <SidebarLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={isActive(item.href)}
                />
              ))}
            </NavSection>
            {boardsNav}
            {dashboardsNav}
            <div
              data-scroll-spacer=""
              className="h-3.5 shrink-0"
              aria-hidden="true"
            />
          </>
        )}
      </div>

      {/* The hairline is INSET to the row column (`mx-2`, spec §4) instead of
          running edge to edge, and it is the only rule here — the collapsed
          rail no longer stacks a RailDivider on top of it. */}
      <footer
        data-testid="sidebar-footer"
        className={
          isCollapsed
            ? "border-border mx-2 flex flex-col items-center gap-0.5 border-t pt-2 pb-2"
            : "border-border mx-2 flex flex-col gap-0.5 border-t pt-2 pb-2"
        }
      >
        {isCollapsed
          ? FOOTER.map((item) => (
              <RailLink
                key={item.href}
                item={item}
                active={isActive(item.href)}
                coarse={coarse}
              />
            ))
          : FOOTER.map((item) => (
              <SidebarLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isActive(item.href)}
              />
            ))}
      </footer>
    </div>
  );
}
