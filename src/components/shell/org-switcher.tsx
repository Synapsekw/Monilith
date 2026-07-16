"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";
import { setActiveOrg } from "@/lib/org/active-actions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Org = { id: string; name: string };

export function OrgSwitcher({
  orgs,
  activeOrgId,
  collapsed = false,
}: {
  orgs: Org[];
  activeOrgId: string;
  collapsed?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const active = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];
  const initial = (active?.name ?? "?").charAt(0).toUpperCase();

  function switchTo(id: string) {
    if (id === activeOrgId) return;
    startTransition(async () => {
      await setActiveOrg(id);
      router.refresh();
    });
  }

  if (orgs.length <= 1) return null;

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
                aria-label="Switch organization"
                className="bg-surface-muted border-border card-lift hover:border-border-bright flex size-9 items-center justify-center rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
              >
                {avatar}
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{active?.name}</TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuTrigger
            aria-label="Switch organization"
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
            Organizations
          </DropdownMenuLabel>
          {orgs.map((o) => (
            <DropdownMenuItem
              key={o.id}
              onSelect={() => switchTo(o.id)}
              className="gap-2"
            >
              <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded text-[10px] font-semibold">
                {o.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              {o.id === activeOrgId ? (
                <Check className="text-primary size-4 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
