"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Clock,
  Gauge,
  ListTodo,
  Target,
  Trash2,
} from "lucide-react";
import type { ComponentType } from "react";
import { BoardsNav } from "@/components/boards/BoardsNav";
import { DashboardsNav } from "@/components/dashboards/DashboardsNav";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { NavSection } from "@/components/shell/nav-section";
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

type NavLink = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

const HOME: NavLink = { label: "My Work", href: "/my-work", icon: ListTodo };
const PLANNING: NavLink[] = [
  { label: "Goals", href: "/goals", icon: Target },
  { label: "Portfolios", href: "/portfolios", icon: BarChart3 },
  { label: "Workload", href: "/workload", icon: Gauge },
];
const PERSONAL: NavLink[] = [{ label: "My Time", href: "/time", icon: Clock }];
const TRASH: NavLink = {
  label: "Trash",
  href: "/boards#archived",
  icon: Trash2,
};
const ALL_LINKS: NavLink[] = [HOME, ...PLANNING, ...PERSONAL, TRASH];

function CoarseCaption({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground max-w-full truncate text-[10px] leading-tight">
      {label}
    </span>
  );
}

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/** Expanded (full-label) nav link. */
function ExpandedLink({ item, active }: { item: NavLink; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-primary/80 text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <item.icon className="size-4" />
      {item.label}
    </Link>
  );
}

/** Collapsed icon-only rail link (with a coarse-pointer caption; gotcha-47). */
function CollapsedLink({
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
          className={cn(
            "flex size-9 max-w-full flex-col items-center justify-center gap-0.5 rounded-md transition-colors pointer-coarse:size-auto pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-1 pointer-coarse:py-1.5",
            active
              ? "bg-primary/80 text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
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
 * Direction B sidebar body. Order: workspace switcher -> My Work -> Planning ->
 * Boards -> Dashboards -> Personal. Boards/Dashboards carry their own collapsible
 * headers (NavSection). Platform admin now lives in the header, not here.
 */
export function SidebarNav({
  boards,
  sharedBoards,
  workspaces,
  activeWorkspaceId = "",
  dashboards,
  forceExpanded = false,
}: {
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkspaceSwitcher
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        collapsed={isCollapsed}
      />

      {!isCollapsed ? (
        <Separator className="mx-3 my-1 data-horizontal:w-auto" />
      ) : null}

      {isCollapsed ? (
        <nav className="flex flex-col items-center gap-0.5 px-2 py-2">
          {ALL_LINKS.map((item) => (
            <CollapsedLink
              key={item.href}
              item={item}
              active={isActive(item.href)}
              coarse={coarse}
            />
          ))}
        </nav>
      ) : (
        <nav className="flex flex-col gap-0.5 px-2 pt-2">
          <ExpandedLink item={HOME} active={isActive(HOME.href)} />
        </nav>
      )}

      {!isCollapsed ? (
        <NavSection storageKey="planning" title="Planning">
          {PLANNING.map((item) => (
            <ExpandedLink
              key={item.href}
              item={item}
              active={isActive(item.href)}
            />
          ))}
        </NavSection>
      ) : null}

      {!isCollapsed ? (
        <Separator className="mx-3 my-1 data-horizontal:w-auto" />
      ) : null}

      <BoardsNav
        boards={boards}
        sharedBoards={sharedBoards}
        activeWorkspaceId={activeWorkspaceId}
        collapsed={isCollapsed}
      />

      {!isCollapsed ? (
        <Separator className="mx-3 my-1 data-horizontal:w-auto" />
      ) : null}

      <DashboardsNav
        dashboards={dashboards}
        activeWorkspaceId={activeWorkspaceId}
        collapsed={isCollapsed}
      />

      {!isCollapsed ? (
        <NavSection storageKey="personal" title="Personal">
          {PERSONAL.map((item) => (
            <ExpandedLink
              key={item.href}
              item={item}
              active={isActive(item.href)}
            />
          ))}
        </NavSection>
      ) : null}

      {!isCollapsed ? (
        <nav className="flex flex-col gap-0.5 px-2 pb-2">
          <ExpandedLink item={TRASH} active={isActive(TRASH.href)} />
        </nav>
      ) : null}
    </div>
  );
}
