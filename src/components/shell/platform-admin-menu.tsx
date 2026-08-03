"use client";

import Link from "next/link";
import {
  Shield,
  LayoutDashboard,
  Building2,
  Users,
  ScrollText,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const LINKS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/feedback", label: "Feedback", icon: MessageSquare },
] as const;

/**
 * The single home for platform (super-admin) tools — a header button, gated on
 * `isPlatformAdmin`. Replaces the old bottom-of-sidebar PlatformNav group and
 * the duplicate item in the user menu. A dot on the button + a count next to
 * Feedback surface unresolved feedback.
 */
export function PlatformAdminMenu({
  isPlatformAdmin = false,
  newCount = 0,
}: {
  isPlatformAdmin?: boolean;
  newCount?: number;
}) {
  if (!isPlatformAdmin) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Platform admin"
          className="text-muted-foreground hover:text-foreground relative"
        >
          <Shield className="size-5" />
          {newCount > 0 ? (
            <span
              aria-hidden
              className="bg-primary absolute top-1.5 right-1.5 size-2 rounded-full"
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Shield className="size-3.5" />
          Platform admin
          <span className="bg-primary/15 text-primary text-3xs ml-auto rounded px-1.5 py-0.5 font-bold tracking-wider">
            SUPER
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LINKS.map((l) => (
          <DropdownMenuItem asChild key={l.href}>
            <Link href={l.href} className="flex items-center gap-2">
              <l.icon className="size-4" />
              {l.label}
              {l.href === "/admin/feedback" && newCount > 0 ? (
                <span className="bg-primary/15 text-primary text-3xs ml-auto rounded px-1.5 py-0.5 font-bold tabular-nums">
                  {newCount}
                </span>
              ) : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
