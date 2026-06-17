import type { ReactNode } from "react";
import { BarChart3, Inbox, LayoutGrid, Target } from "lucide-react";
import { signOut } from "@/app/auth/actions";
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
import { BoardsNav } from "@/components/boards/BoardsNav";
import type { BoardListEntry } from "@/lib/boards/queries";

const nav = [
  { label: "Dashboards", icon: LayoutGrid },
  { label: "Goals", icon: Target },
  { label: "Portfolios", icon: BarChart3 },
  { label: "Inbox", icon: Inbox },
] as const;

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

type AppShellProps = {
  children: ReactNode;
  user?: AppShellUser;
  currentUserId?: string;
  org?: AppShellOrg;
  workspaces?: AppShellWorkspace[];
  boards?: BoardListEntry[];
  activeBoardId?: string;
};

function Brand({ org }: { org?: AppShellOrg }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-sm font-semibold">
          P
        </div>
        <span className="text-sm font-semibold tracking-tight">Pulse</span>
      </div>
      {org ? (
        <span className="text-muted-foreground truncate pl-9 text-xs">
          {org.name}
        </span>
      ) : null}
    </div>
  );
}

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
  org,
  workspaces,
  boards,
  activeBoardId,
}: AppShellProps) {
  return (
    <div className="flex h-svh w-full overflow-hidden">
      <aside className="bg-sidebar hidden w-60 shrink-0 flex-col border-r md:flex">
        <div className="flex min-h-14 items-center px-4 py-2">
          <Brand org={org} />
        </div>
        <BoardsNav
          boards={boards ?? []}
          workspaces={workspaces ?? []}
          activeBoardId={activeBoardId}
        />
        <nav className="flex flex-col gap-0.5 px-2 py-2">
          {nav.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              <item.icon className="size-4" />
              {item.label}
            </button>
          ))}
        </nav>
        {workspaces && workspaces.length > 0 ? (
          <div className="mt-2 flex flex-col gap-0.5 px-2">
            <p className="text-muted-foreground px-3 py-1 text-xs font-medium">
              Workspaces
            </p>
            {workspaces.map((workspace) => (
              <span
                key={workspace.id}
                className="text-muted-foreground truncate rounded-md px-3 py-1.5 text-sm"
              >
                {workspace.name}
              </span>
            ))}
          </div>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
          <div className="md:hidden">
            <Brand org={org} />
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
    </div>
  );
}
