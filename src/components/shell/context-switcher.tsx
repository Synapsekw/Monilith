"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronsUpDown, Plus, Settings2 } from "lucide-react";
import { setActiveOrg } from "@/lib/org/active-actions";
import { setActiveWorkspace } from "@/lib/workspaces/active-actions";
import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";
import { Kicker } from "@/components/ui/kicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Named = { id: string; name: string };

const NO_ORGS: Named[] = [];

/**
 * The sidebar's one context control: which organization and which workspace
 * you are looking at. Replaces the former stacked OrgSwitcher + WorkspaceSwitcher
 * twins. The org only appears (as a mono kicker over the workspace name, and
 * as a group in the menu) when the user belongs to more than one.
 *
 * A Keystone chip: alpha fill on the wash, hairline that BRIGHTENS on hover —
 * no lift (that is a card gesture, not a nav one).
 */
export function ContextSwitcher({
  orgs = NO_ORGS,
  activeOrgId = "",
  workspaces,
  activeWorkspaceId = "",
  collapsed = false,
}: {
  orgs?: Named[];
  activeOrgId?: string;
  workspaces: Named[];
  activeWorkspaceId?: string;
  collapsed?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [newOpen, setNewOpen] = useState(false);

  const multiOrg = orgs.length > 1;
  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];
  const activeWs =
    workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];

  function switchOrg(id: string) {
    if (id === activeOrgId) return;
    startTransition(async () => {
      await setActiveOrg(id);
      router.refresh();
    });
  }
  function switchWorkspace(id: string) {
    if (id === activeWorkspaceId) return;
    startTransition(async () => {
      await setActiveWorkspace(id);
      router.refresh();
    });
  }

  // A multi-org user whose ACTIVE org has no workspaces still needs the chip —
  // it is the only way back to the org that does have them. Only a single-org
  // user with nothing to switch to gets nothing.
  if (!activeWs && !(multiOrg && activeOrg)) return null;

  const label = multiOrg
    ? "Switch organization or workspace"
    : "Switch workspace";
  // With no workspace the org takes the bold line (and the kicker is dropped:
  // the name would otherwise be printed twice).
  const primaryName = activeWs?.name ?? activeOrg?.name ?? "";
  const showKicker = multiOrg && Boolean(activeOrg) && Boolean(activeWs);
  const tooltip = activeWs
    ? multiOrg && activeOrg
      ? `${activeWs.name} · ${activeOrg.name}`
      : activeWs.name
    : (activeOrg?.name ?? "");
  const initial = primaryName.charAt(0).toUpperCase();
  const chip =
    "bg-chrome-fill border-border hover:border-border-bright focus-visible:ring-ring flex items-center rounded-lg border transition-colors duration-300 ease-keystone focus-visible:ring-2 focus-visible:outline-none";

  const menu = (
    <DropdownMenuContent align="start" className="w-60">
      {multiOrg ? (
        <>
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            Organization
          </DropdownMenuLabel>
          {orgs.map((o) => (
            <MenuRow
              key={o.id}
              item={o}
              active={o.id === activeOrgId}
              onSelect={() => switchOrg(o.id)}
            />
          ))}
          <DropdownMenuSeparator />
        </>
      ) : null}
      {workspaces.length > 0 ? (
        <>
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            Workspaces
          </DropdownMenuLabel>
          {workspaces.map((w) => (
            <MenuRow
              key={w.id}
              item={w}
              active={w.id === activeWs?.id}
              onSelect={() => switchWorkspace(w.id)}
            />
          ))}
          <DropdownMenuSeparator />
        </>
      ) : null}
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
  );

  return (
    <div className={cn("px-2 pt-2", collapsed && "flex justify-center")}>
      <DropdownMenu>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger
                aria-label={label}
                className={cn(chip, "size-9 justify-center")}
              >
                <Avatar initial={initial} />
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{tooltip}</TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuTrigger
            aria-label={label}
            className={cn(chip, "w-full gap-2.5 px-2 py-1.5 text-left")}
          >
            <Avatar initial={initial} />
            <span className="flex min-w-0 flex-1 flex-col">
              {showKicker && activeOrg ? (
                <Kicker size="xs" className="truncate leading-tight">
                  {activeOrg.name}
                </Kicker>
              ) : null}
              <span className="truncate text-sm leading-tight font-bold">
                {primaryName}
              </span>
            </span>
            <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
          </DropdownMenuTrigger>
        )}
        {menu}
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

function Avatar({ initial }: { initial: string }) {
  return (
    <span className="bg-primary/[0.18] text-primary flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold">
      {initial}
    </span>
  );
}

function MenuRow({
  item,
  active,
  onSelect,
}: {
  item: Named;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-2">
      <span className="bg-primary text-primary-foreground text-3xs flex size-5 items-center justify-center rounded font-semibold">
        {item.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      {active ? <Check className="text-primary size-4 shrink-0" /> : null}
    </DropdownMenuItem>
  );
}
