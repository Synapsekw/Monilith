"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronsUpDown, Plus, Settings2 } from "lucide-react";
import { setActiveWorkspace } from "@/lib/workspaces/active-actions";
import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Workspace = { id: string; name: string };

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  collapsed = false,
}: {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  collapsed?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [newOpen, setNewOpen] = useState(false);

  const active =
    workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];
  const initial = (active?.name ?? "?").charAt(0).toUpperCase();

  function switchTo(id: string) {
    if (id === activeWorkspaceId) return;
    startTransition(async () => {
      await setActiveWorkspace(id);
      router.refresh();
    });
  }

  if (workspaces.length === 0) return null;

  const avatar = (
    <span className="bg-primary/[0.18] text-primary flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold">
      {initial}
    </span>
  );

  return (
    <div className={cn("px-2 pt-2", collapsed ? "flex justify-center" : "")}>
      <DropdownMenu>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger
                aria-label="Switch workspace"
                className="bg-surface-muted border-border card-lift hover:border-border-bright flex size-9 items-center justify-center rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
              >
                {avatar}
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{active?.name}</TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuTrigger
            aria-label="Switch workspace"
            className="bg-surface-muted border-border card-lift hover:border-border-bright flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
          >
            {avatar}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {active?.name}
            </span>
            <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
          </DropdownMenuTrigger>
        )}

        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            Workspaces
          </DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => switchTo(w.id)}
              className="gap-2"
            >
              <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded text-[10px] font-semibold">
                {w.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.id === activeWorkspaceId ? (
                <Check className="text-primary size-4 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setNewOpen(true)} className="gap-2">
            <Plus className="size-4" />
            New workspace
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings" className="flex items-center gap-2">
              <Settings2 className="size-4" />
              Manage workspaces
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Controlled, triggerless — opened from the menu item above. */}
      <NewWorkspaceDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        showTrigger={false}
      />
    </div>
  );
}
