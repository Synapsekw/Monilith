"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FolderInput, Plus, Sparkles } from "lucide-react";
import { DashboardCanvasLazy } from "@/components/dashboards/DashboardCanvasLazy";
import { NewDashboardDialog } from "@/components/dashboards/NewDashboardDialog";
import { AiDashboardWizard } from "@/components/dashboards/ai/AiDashboardWizard";
import type { BoardOption } from "@/components/dashboards/WidgetConfigForm";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { attachDashboardToFolder } from "@/lib/folders/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import type { Tables } from "@/types/database.types";

/**
 * Spec §5.2.7: the folder's folded-in dashboards, one canvas section each,
 * rendered through the existing DashboardCanvasLazy (same edit mode, config
 * sheet and batched getWidgetsData). Below the fold; the widget DATA loads
 * lazily exactly as it does on /dashboards/[id].
 *
 * Honours `?ai=1` (set by AiReviewBanner's Regenerate, or a direct deep link)
 * by opening the Generate-with-AI wizard on mount — a client-only read of the
 * URL, no extra server round-trip (working agreement #5).
 */
export function YourWidgets({
  folderId,
  workspaceId,
  dashboards,
  boards,
  unfiled,
}: {
  folderId: string;
  workspaceId: string;
  dashboards: {
    dashboard: Tables<"dashboards">;
    widgets: Tables<"dashboard_widgets">[];
  }[];
  boards: BoardOption[];
  unfiled: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [newOpen, setNewOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(() => searchParams.get("ai") === "1");

  function attach(dashboardId: string) {
    startTransition(async () => {
      const res = await attachDashboardToFolder({ dashboardId, folderId });
      if (!res.ok) {
        showMutationError(
          "Couldn't attach the dashboard.",
          new Error(res.error),
        );
        return;
      }
      router.refresh();
    });
  }

  // Clears the one-shot `?ai=1` flag once the wizard is dismissed/opened, so a
  // later refresh of this page doesn't reopen it. History API only — no RSC nav.
  function handleAiOpenChange(open: boolean) {
    setAiOpen(open);
    if (!open && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("ai");
      window.history.replaceState({}, "", url);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between" data-print-hide>
        <div>
          <Kicker>07</Kicker>
          <h2 className="text-sm font-semibold">Your widgets</h2>
        </div>
        <div className="flex gap-2">
          {unfiled.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="ghost">
                  <FolderInput className="size-4" /> Attach existing
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {unfiled.map((d) => (
                  <DropdownMenuItem key={d.id} onSelect={() => attach(d.id)}>
                    {d.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAiOpen(true)}
          >
            <Sparkles className="size-4" /> Generate with AI
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setNewOpen(true)}
          >
            <Plus className="size-4" /> New dashboard
          </Button>
        </div>
      </div>
      {dashboards.length === 0 ? (
        <EmptyState>
          No widgets yet. Add a dashboard to this folder, or generate one from a
          board.
        </EmptyState>
      ) : (
        dashboards.map(({ dashboard, widgets }) => (
          <div key={dashboard.id} className="rounded-lg border p-2">
            <DashboardCanvasLazy
              initialData={{ dashboard, widgets }}
              boards={boards}
            />
          </div>
        ))
      )}
      <NewDashboardDialog
        workspaceId={workspaceId}
        folderId={folderId}
        open={newOpen}
        onOpenChange={setNewOpen}
      />
      {aiOpen ? (
        <AiDashboardWizard
          workspaceId={workspaceId}
          folderId={folderId}
          open={aiOpen}
          onOpenChange={handleAiOpenChange}
        />
      ) : null}
    </section>
  );
}
