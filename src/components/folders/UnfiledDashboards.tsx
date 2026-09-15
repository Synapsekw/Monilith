"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FolderInput, Plus } from "lucide-react";
import { attachDashboardToFolder } from "@/lib/folders/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NewDashboardDialog } from "@/components/dashboards/NewDashboardDialog";
import { useUIStore } from "@/stores/ui";

// Lazy-load the wizard (and its action/SDK imports) only when needed — the
// same code-splitting the deleted `DashboardsNav` used.
const AiDashboardWizard = dynamic(
  () =>
    import("@/components/dashboards/ai/AiDashboardWizard").then(
      (m) => m.AiDashboardWizard,
    ),
  { ssr: false },
);

/**
 * "Unfiled dashboards" section with the attach picker; also the client island
 * that hosts the two global "create a dashboard" entry points that died with
 * the deleted `DashboardsNav` (ruling 1): the ⌘K "New dashboard" command
 * (`useUIStore.newDashboardOpen`) and the `AiReviewBanner` "Regenerate" path,
 * which routes back to `/dashboards?ai=1` to reopen the AI wizard. Task 13
 * owns the equivalent per-folder entry on the Overview strip.
 */
export function UnfiledDashboards({
  dashboards,
  folders,
  workspaceId,
}: {
  dashboards: { id: string; name: string }[];
  folders: { id: string; name: string }[];
  workspaceId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const storeOpen = useUIStore((s) => s.newDashboardOpen);
  const setStoreOpen = useUIStore((s) => s.setNewDashboardOpen);
  const [localOpen, setLocalOpen] = useState(false);
  const open = storeOpen || localOpen;
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    if (!next) setStoreOpen(false);
  };
  // Seeded from the initial URL via a lazy initializer so a later navigation
  // that drops the param doesn't force the wizard back open.
  const [aiOpen, setAiOpen] = useState(() => searchParams.get("ai") === "1");

  function attach(dashboardId: string, folderId: string) {
    startTransition(async () => {
      const res = await attachDashboardToFolder({ dashboardId, folderId });
      if (!res.ok) {
        showMutationError(
          "Couldn't attach the dashboard.",
          new Error(res.error),
        );
        return;
      }
      router.refresh(); // server data changed
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <Kicker>02</Kicker>
          <h2 className="text-sm font-semibold">Unfiled dashboards</h2>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
        >
          <Plus className="size-4" /> New dashboard
        </Button>
      </div>
      {dashboards.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Every dashboard belongs to a folder.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {dashboards.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between px-3 py-2 text-sm"
            >
              <Link href={`/dashboards/${d.id}`} className="font-medium">
                {d.name}
              </Link>
              {folders.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Attach ${d.name} to a folder`}
                    >
                      <FolderInput className="size-4" /> Attach
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {folders.map((f) => (
                      <DropdownMenuItem
                        key={f.id}
                        onSelect={() => attach(d.id, f.id)}
                      >
                        {f.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <NewDashboardDialog
        workspaceId={workspaceId}
        open={open}
        onOpenChange={setOpen}
      />
      {aiOpen ? (
        <AiDashboardWizard
          workspaceId={workspaceId}
          open={aiOpen}
          onOpenChange={setAiOpen}
        />
      ) : null}
    </section>
  );
}
