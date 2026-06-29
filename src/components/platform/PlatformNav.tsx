"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  Building2,
  Users,
  ScrollText,
  Shield,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Visible caption for a collapsed icon-only admin link under a coarse pointer.
 * Closes gotcha-47 for the platform nav: the touch-suppressed tooltip is no
 * longer the link's only label. Text equals the trigger's `aria-label` (single
 * source) and is `truncate`d so it never widens the `w-14` rail.
 */
function CoarseCaption({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground max-w-full truncate text-[10px] leading-tight">
      {label}
    </span>
  );
}

type PlatformLink = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
};

const LINKS: readonly PlatformLink[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/feedback", label: "Feedback", icon: MessageSquare },
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  return exact ? pathname === href : pathname.startsWith(href);
}

export function PlatformNav({
  isPlatformAdmin = false,
  collapsed = false,
  newCount = 0,
}: {
  isPlatformAdmin?: boolean;
  collapsed?: boolean;
  newCount?: number;
}) {
  const pathname = usePathname();
  const coarse = useCoarsePointer();
  const [open, setOpen] = useState(true);

  if (!isPlatformAdmin) return null;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-0.5 px-2 py-2">
        {LINKS.map((l) => (
          <Tooltip key={l.href}>
            <TooltipTrigger asChild>
              <Link
                href={l.href}
                aria-label={l.label}
                aria-current={
                  isActive(pathname, l.href, l.exact) ? "page" : undefined
                }
                className={cn(
                  "flex size-9 max-w-full flex-col items-center justify-center gap-0.5 rounded-md transition-colors pointer-coarse:size-auto pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-1 pointer-coarse:py-1.5",
                  isActive(pathname, l.href, l.exact)
                    ? "bg-primary/80 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <l.icon className="size-4 shrink-0" />
                {coarse ? <CoarseCaption label={l.label} /> : null}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{l.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-0.5 border-t px-2 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-md px-3 py-1 text-xs font-semibold tracking-wide transition-colors"
      >
        {open ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        <Shield className="size-3.5" />
        PLATFORM
        <span className="bg-primary/15 text-primary ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider">
          SUPER
        </span>
      </button>
      {open
        ? LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={
                isActive(pathname, l.href, l.exact) ? "page" : undefined
              }
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                isActive(pathname, l.href, l.exact)
                  ? "border-primary bg-primary/80 text-foreground border-l-2"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground border-l-2 border-transparent",
              )}
            >
              <l.icon className="size-4" />
              {l.label}
              {l.href === "/admin/feedback" && newCount > 0 ? (
                <span className="bg-primary/15 text-primary ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider tabular-nums">
                  {newCount}
                </span>
              ) : null}
            </Link>
          ))
        : null}
    </div>
  );
}
