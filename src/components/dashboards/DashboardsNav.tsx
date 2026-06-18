"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { LayoutGrid, Plus } from "lucide-react";
import { createDashboard } from "@/lib/dashboards/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function DashboardsNav({
  dashboards,
  workspaces,
  collapsed = false,
}: {
  dashboards: { id: string; name: string }[];
  workspaces: { id: string; name: string }[];
  collapsed?: boolean;
}) {
  const router = useRouter();
  const { dashboardId: activeDashboardId } = useParams<{
    dashboardId: string;
  }>();
  const storeOpen = useUIStore((s) => s.newDashboardOpen);
  const setNewDashboardOpen = useUIStore((s) => s.setNewDashboardOpen);
  const [localOpen, setLocalOpen] = useState(false);
  const open = storeOpen || localOpen;
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    if (!next) setNewDashboardOpen(false);
  };
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const workspaceId = workspaces[0]?.id;

  function submit() {
    if (!workspaceId) return;
    setError(null);
    startTransition(async () => {
      const res = await createDashboard({ workspaceId, name });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setName("");
      router.push(`/dashboards/${res.data.dashboard.id}`);
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 py-2",
        collapsed ? "items-center px-2" : "px-2",
      )}
    >
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/dashboards"
              aria-label="Dashboards"
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-9 items-center justify-center rounded-md transition-colors"
            >
              <LayoutGrid className="size-4" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Dashboards</TooltipContent>
        </Tooltip>
      ) : (
        <div className="flex items-center justify-between px-3 py-1">
          <Link
            href="/dashboards"
            className="text-muted-foreground hover:text-foreground flex items-center gap-2.5 text-sm transition-colors"
          >
            <LayoutGrid className="size-4" />
            Dashboards
          </Link>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="New dashboard"
                className="size-6"
              >
                <Plus className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New dashboard</DialogTitle>
                <DialogDescription>
                  Give your dashboard a name to get started.
                </DialogDescription>
              </DialogHeader>
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="dashboard-name">Dashboard name</Label>
                  <Input
                    id="dashboard-name"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Team overview"
                  />
                </div>
                {error ? (
                  <p role="alert" className="text-destructive text-xs">
                    {error}
                  </p>
                ) : null}
                <DialogFooter>
                  <Button type="submit" disabled={isPending || !name.trim()}>
                    {isPending ? "Creating…" : "Create dashboard"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {dashboards.length === 0 ? (
        collapsed ? null : (
          <p className="text-muted-foreground px-3 py-1 text-xs">
            No dashboards yet
          </p>
        )
      ) : (
        dashboards.map((d) =>
          collapsed ? (
            <Tooltip key={d.id}>
              <TooltipTrigger asChild>
                <Link
                  href={`/dashboards/${d.id}`}
                  aria-current={d.id === activeDashboardId ? "page" : undefined}
                  aria-label={d.name}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md text-sm font-medium uppercase transition-colors",
                    d.id === activeDashboardId
                      ? "bg-surface text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {d.name.charAt(0)}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{d.name}</TooltipContent>
            </Tooltip>
          ) : (
            <Link
              key={d.id}
              href={`/dashboards/${d.id}`}
              aria-current={d.id === activeDashboardId ? "page" : undefined}
              className={cn(
                "truncate rounded-md px-3 py-1 text-sm transition-colors",
                d.id === activeDashboardId
                  ? "bg-surface text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {d.name}
            </Link>
          ),
        )
      )}
    </div>
  );
}
