"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  LayoutGrid,
  Monitor,
  Moon,
  Plus,
  Sun,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useUIStore } from "@/stores/ui";
import type { BoardListEntry } from "@/lib/boards/queries";

export function CommandPalette({
  boards,
  dashboards,
  workspaces,
}: {
  boards: BoardListEntry[];
  dashboards: { id: string; name: string }[];
  workspaces: { id: string; name: string }[];
}) {
  const open = useUIStore((s) => s.commandOpen);
  const setOpen = useUIStore((s) => s.setCommandOpen);
  const toggle = useUIStore((s) => s.toggleCommand);
  const setNewBoardOpen = useUIStore((s) => s.setNewBoardOpen);
  const setNewDashboardOpen = useUIStore((s) => s.setNewDashboardOpen);
  const router = useRouter();
  const { setTheme } = useTheme();
  const canCreate = Boolean(workspaces[0]?.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Search and run actions"
    >
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => run(() => router.push("/dashboards"))}>
            <LayoutDashboard className="size-4" /> Dashboards
          </CommandItem>
          {boards.map((b) => (
            <CommandItem
              key={b.id}
              value={`board ${b.name}`}
              onSelect={() => run(() => router.push(`/boards/${b.id}`))}
            >
              <LayoutGrid className="size-4" /> {b.name}
            </CommandItem>
          ))}
          {dashboards.map((d) => (
            <CommandItem
              key={d.id}
              value={`dashboard ${d.name}`}
              onSelect={() => run(() => router.push(`/dashboards/${d.id}`))}
            >
              <LayoutDashboard className="size-4" /> {d.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Create">
          <CommandItem
            disabled={!canCreate}
            onSelect={() => run(() => setNewBoardOpen(true))}
          >
            <Plus className="size-4" /> New board
          </CommandItem>
          <CommandItem
            disabled={!canCreate}
            onSelect={() => run(() => setNewDashboardOpen(true))}
          >
            <Plus className="size-4" /> New dashboard
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem onSelect={() => run(() => setTheme("light"))}>
            <Sun className="size-4" /> Light
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("dark"))}>
            <Moon className="size-4" /> Dark
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("system"))}>
            <Monitor className="size-4" /> System
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
