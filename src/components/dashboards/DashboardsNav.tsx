"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Plus, Sparkles } from "lucide-react";
import { createDashboard } from "@/lib/dashboards/actions";
import { DashboardItemMenu } from "@/components/dashboards/DashboardItemMenu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Lazy-load the wizard (and its action/SDK imports) only when needed.
const AiDashboardWizard = dynamic(
  () =>
    import("@/components/dashboards/ai/AiDashboardWizard").then(
      (m) => m.AiDashboardWizard,
    ),
  { ssr: false },
);
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Visible caption for a collapsed icon/initial rail item under a coarse pointer.
 * Closes gotcha-47 for the dashboards list: the touch-suppressed tooltip is no
 * longer an item's only label. Text equals the trigger's `aria-label` (single
 * source) and is `truncate`d so a long name never widens the `w-14` rail.
 */
function CoarseCaption({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground max-w-full truncate text-[10px] leading-tight normal-case">
      {label}
    </span>
  );
}

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
  const searchParams = useSearchParams();
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
  // Auto-open the AI wizard once when arriving with ?ai=1 (the review banner's
  // "Regenerate" action routes back here to reopen it). Seeded from the initial
  // URL via a lazy initializer so later navigations that drop the param don't
  // force it back open.
  const [aiOpen, setAiOpen] = useState(() => searchParams.get("ai") === "1");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const coarse = useCoarsePointer();
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
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-9 max-w-full flex-col items-center justify-center gap-0.5 rounded-md transition-colors pointer-coarse:size-auto pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-1 pointer-coarse:py-1.5"
            >
              <LayoutGrid className="size-4 shrink-0" />
              {coarse ? <CoarseCaption label="Dashboards" /> : null}
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Dashboards</TooltipContent>
        </Tooltip>
      ) : (
        <div className="flex items-center justify-between px-3 py-1">
          <Link
            href="/dashboards"
            className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs font-medium transition-colors"
          >
            <LayoutGrid className="size-4" />
            Dashboards
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="New dashboard"
                className="size-6"
              >
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => setOpen(true)}>
                <Plus className="size-4" />
                Blank dashboard
              </DropdownMenuItem>
              {workspaceId ? (
                <DropdownMenuItem onSelect={() => setAiOpen(true)}>
                  <Sparkles className="size-4" />
                  Generate with AI
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Controlled dialog, mounted regardless of collapsed state so the ⌘K
          "New dashboard" command can open it from the store flag. */}
      <Dialog open={open} onOpenChange={setOpen}>
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

      {workspaceId && aiOpen ? (
        <AiDashboardWizard
          workspaceId={workspaceId}
          open={aiOpen}
          onOpenChange={setAiOpen}
        />
      ) : null}

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
                    "flex size-9 max-w-full flex-col items-center justify-center rounded-md text-sm font-medium uppercase transition-colors pointer-coarse:size-auto pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:gap-0.5 pointer-coarse:px-1 pointer-coarse:py-1.5",
                    d.id === activeDashboardId
                      ? "bg-primary/80 text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="shrink-0">{d.name.charAt(0)}</span>
                  {coarse ? <CoarseCaption label={d.name} /> : null}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{d.name}</TooltipContent>
            </Tooltip>
          ) : (
            <div
              key={d.id}
              className={cn(
                "group/row flex items-center rounded-md pr-1 transition-colors",
                d.id === activeDashboardId
                  ? "bg-primary/80 text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Link
                href={`/dashboards/${d.id}`}
                aria-current={d.id === activeDashboardId ? "page" : undefined}
                className="min-w-0 flex-1 truncate px-3 py-1 text-sm"
              >
                {d.name}
              </Link>
              <DashboardItemMenu
                dashboard={{ id: d.id, name: d.name }}
                isActive={d.id === activeDashboardId}
              />
            </div>
          ),
        )
      )}
    </div>
  );
}
