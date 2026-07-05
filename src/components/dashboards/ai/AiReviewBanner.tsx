"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, CheckCircle, Trash2, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deleteDashboard } from "@/lib/dashboards/actions";

interface AiReviewBannerProps {
  dashboardId: string;
}

export function AiReviewBanner({ dashboardId }: AiReviewBannerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function handleKeep() {
    // Drop ?review=1 from the URL via the History API — no RSC re-render — then
    // hide the banner locally (same in-page dismissal as the X button below).
    window.history.replaceState(null, "", `/dashboards/${dashboardId}`);
    setDismissed(true);
  }

  function handleDiscard() {
    setError(null);
    startTransition(async () => {
      const result = await deleteDashboard({ dashboardId });
      if (!result.ok) {
        setError(result.error ?? "Failed to discard dashboard.");
        return;
      }
      router.push("/dashboards");
    });
  }

  function handleRegenerate() {
    setError(null);
    startTransition(async () => {
      const result = await deleteDashboard({ dashboardId });
      if (!result.ok) {
        setError(result.error ?? "Failed to discard dashboard.");
        return;
      }
      // Route to /dashboards?ai=1 — the ?ai=1 param re-opens the AI wizard
      // (contract with the wizard component in Task 6).
      router.push("/dashboards?ai=1");
    });
  }

  return (
    <div
      className={cn(
        "border-primary/20 bg-primary/5 relative flex flex-col gap-3 rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:gap-4",
      )}
    >
      {/* Dismiss (keep) icon button */}
      <button
        aria-label="Dismiss banner"
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-2 right-2 rounded-sm p-0.5 focus-visible:ring-2 focus-visible:outline-none"
      >
        <X className="size-3.5" aria-hidden />
      </button>

      {/* Icon + copy */}
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Sparkles className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-sm">
          <span className="font-medium">AI generated</span> this dashboard —
          review it with your live data, then keep it or start over.
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex shrink-0 items-center gap-2 pl-6 sm:pl-0">
        <Button
          size="sm"
          variant="default"
          onClick={handleKeep}
          disabled={isPending}
          aria-label="Keep this dashboard"
        >
          <CheckCircle className="size-3.5" aria-hidden />
          Keep
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRegenerate}
          disabled={isPending}
          aria-label="Regenerate dashboard with AI"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Regenerate
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={handleDiscard}
          disabled={isPending}
          aria-label="Discard this dashboard"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Discard
        </Button>
      </div>

      {/* Inline error — no toast primitive in this project yet */}
      {error && (
        <p
          role="alert"
          className="text-destructive w-full pl-6 text-xs sm:pl-0"
        >
          {error}
        </p>
      )}
    </div>
  );
}
