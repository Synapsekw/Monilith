"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Brand } from "@/components/brand/brand";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import type { ComponentProps } from "react";

type NavData = Omit<ComponentProps<typeof SidebarNav>, "forceExpanded">;

/**
 * Below `md` the desktop rail is hidden, so navigation lives behind a hamburger
 * that opens the same nav in a left Sheet. The nav body is the shared
 * `SidebarNav` (single source — a new nav item is added there once and appears
 * in both the rail and this drawer), rendered `forceExpanded` since the drawer
 * is full-width. Focus trap, Escape, and overlay dismissal come from the Sheet
 * primitive; keying the (uncontrolled) sheet on the pathname remounts it closed
 * on navigation, so a tapped link never leaves the drawer hanging open.
 */
export function MobileNav(props: NavData) {
  const pathname = usePathname();

  return (
    <Sheet key={pathname}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Open navigation menu"
          className="text-muted-foreground hover:text-foreground md:hidden"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 max-w-[85vw] gap-0 p-0">
        <SheetHeader className="min-h-14 justify-center px-3 py-2">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand />
        </SheetHeader>
        <div
          data-scroll-container
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          <SidebarNav {...props} forceExpanded />
        </div>
      </SheetContent>
    </Sheet>
  );
}
