"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  LayoutGrid,
  Rocket,
  Megaphone,
  BarChart3,
  Loader2,
  Plus,
} from "lucide-react";
import { createBoardFromTemplate } from "@/lib/boards/actions";
import { BOARD_TEMPLATES } from "@/lib/boards/templates";
import { MonolithMark } from "@/components/brand/monolith-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  board: LayoutGrid,
  rocket: Rocket,
  megaphone: Megaphone,
  dashboard: BarChart3,
};

/**
 * First-run empty state for a user with no boards. Surfaces the built-in
 * template catalogue directly as one-click cards (create-and-open) and a
 * primary CTA that opens the shared New board dialog (naming + file import).
 * Reuses `createBoardFromTemplate` and the `newBoardOpen` store flag — no
 * creation logic is duplicated here.
 */
export function FirstBoardEmptyState({
  orgName,
  workspaceId,
}: {
  orgName: string;
  workspaceId?: string;
}) {
  const router = useRouter();
  const setNewBoardOpen = useUIStore((s) => s.setNewBoardOpen);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function createFrom(templateId: string, name: string) {
    if (!workspaceId || isPending) return;
    setPendingId(templateId);
    startTransition(async () => {
      const res = await createBoardFromTemplate({
        workspaceId,
        templateId,
        name,
      });
      if (!res.ok) {
        setPendingId(null);
        toast.error("Couldn't create your board.", { description: res.error });
        return;
      }
      router.push(`/boards/${res.data.boardId}`);
      router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-lg text-center">
        <div className="bg-surface mx-auto flex size-12 items-center justify-center rounded-xl border">
          <MonolithMark className="text-foreground size-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          Welcome to {orgName}
        </h1>
        <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-sm text-pretty">
          Boards are where your work lives. Pick a template to get moving — you
          can change anything later.
        </p>

        <div className="mt-6">
          <Button
            type="button"
            size="lg"
            className="gap-2"
            disabled={!workspaceId}
            onClick={() => setNewBoardOpen(true)}
          >
            <Plus className="size-4" />
            Create your first board
          </Button>
        </div>

        <div className="mt-8 flex items-center gap-3">
          <div className="border-border h-px flex-1 border-t" />
          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Or start from a template
          </span>
          <div className="border-border h-px flex-1 border-t" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
          {BOARD_TEMPLATES.map((t) => {
            const Icon = ICONS[t.icon] ?? LayoutGrid;
            const loading = pendingId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                disabled={!workspaceId || isPending}
                onClick={() => createFrom(t.id, t.name)}
                className={cn(
                  "bg-surface hover:bg-state-hover focus-visible:ring-ring group flex flex-col items-start gap-1 rounded-md border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60",
                  loading && "bg-accent",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                  {t.name}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
