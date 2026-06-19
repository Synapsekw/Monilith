import type { ReactNode } from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { Brand } from "@/components/brand/brand";
import { Sidebar } from "@/components/sidebar";
import { CommandPalette } from "@/components/command-palette";
import { CommandTrigger } from "@/components/command-trigger";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BoardListEntry } from "@/lib/boards/queries";

export type AppShellUser = {
  email?: string | null;
  full_name?: string | null;
};

export type AppShellOrg = {
  name: string;
};

export type AppShellWorkspace = {
  id: string;
  name: string;
};

export type AppShellDashboard = {
  id: string;
  name: string;
};

type AppShellProps = {
  children: ReactNode;
  user?: AppShellUser;
  currentUserId?: string;
  org?: AppShellOrg;
  workspaces?: AppShellWorkspace[];
  boards?: BoardListEntry[];
  dashboards?: AppShellDashboard[];
};

function initialFor(user: AppShellUser): string {
  const source = user.full_name?.trim() || user.email?.trim() || "";
  return source ? source.charAt(0).toUpperCase() : "?";
}

function UserMenu({ user }: { user: AppShellUser }) {
  const label = user.full_name?.trim() || user.email || "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open user menu"
        className="bg-surface text-foreground hover:bg-accent flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {initialFor(user)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings" className="flex items-center gap-2">
            <Settings className="size-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild variant="destructive">
          <form action={signOut}>
            <button type="submit" className="w-full text-left">
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({
  children,
  user,
  currentUserId,
  workspaces,
  boards,
  dashboards,
}: AppShellProps) {
  return (
    <div className="flex h-svh w-full overflow-hidden">
      <Sidebar
        boards={boards ?? []}
        workspaces={workspaces ?? []}
        dashboards={dashboards ?? []}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <CommandTrigger />
            {currentUserId ? (
              <NotificationsBell userId={currentUserId} />
            ) : null}
            <ThemeToggle />
            {user ? <UserMenu user={user} /> : null}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
      <CommandPalette
        boards={boards ?? []}
        dashboards={dashboards ?? []}
        workspaces={workspaces ?? []}
      />
    </div>
  );
}
