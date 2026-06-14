import type { ReactNode } from "react";
import {
  BarChart3,
  FolderKanban,
  Inbox,
  LayoutGrid,
  Target,
} from "lucide-react";
import { CommandTrigger } from "@/components/command-trigger";
import { ThemeToggle } from "@/components/theme-toggle";

const nav = [
  { label: "Boards", icon: FolderKanban },
  { label: "Dashboards", icon: LayoutGrid },
  { label: "Goals", icon: Target },
  { label: "Portfolios", icon: BarChart3 },
  { label: "Inbox", icon: Inbox },
] as const;

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-sm font-semibold">
        P
      </div>
      <span className="text-sm font-semibold tracking-tight">Pulse</span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-svh w-full overflow-hidden">
      <aside className="bg-sidebar hidden w-60 shrink-0 flex-col border-r md:flex">
        <div className="flex h-14 items-center px-4">
          <Brand />
        </div>
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
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <CommandTrigger />
            <ThemeToggle />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
