"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, CheckCircle, Trash2, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deleteBoard } from "@/lib/boards/actions";

interface AiBoardReviewBannerProps {
  boardId: string;
}

/**
 * F10 post-create convenience banner (mirrors dashboards/ai/AiReviewBanner).
 * The pre-persist review in the wizard is the real approval gate; this lets the
 * user Keep / Discard (existing deleteBoard) / Regenerate the just-created board.
 */
export function AiBoardReviewBanner({ boardId }: AiBoardReviewBannerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function handleKeep() {
    // Drop ?review=1 from the URL via the History API — no RSC re-render — then
    // hide the banner locally.
    window.history.replaceState(null, "", `/boards/${boardId}`);
    setDismissed(true);
  }

  function handleDiscard() {
    setError(null);
    startTransition(async () => {
      const result = await deleteBoard({ boardId });
      if (!result.ok) {
        setError(result.error ?? "Failed to discard board.");
        return;
      }
      router.push("/boards");
    });
  }

  function handleRegenerate() {
    setError(null);
    startTransition(async () => {
      const result = await deleteBoard({ boardId });
      if (!result.ok) {
        setError(result.error ?? "Failed to discard board.");
        return;
      }
      // ?ai=1 re-opens the New-board dialog in AI mode (contract with NewBoardDialog).
      router.push("/boards?ai=1");
    });
  }

  return (
    <div
      className={cn(
        "border-primary/20 bg-primary/5 relative flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:gap-4",
      )}
    >
      <button
        aria-label="Dismiss banner"
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-2 right-2 rounded-sm p-0.5 focus-visible:ring-2 focus-visible:outline-none"
      >
        <X className="size-3.5" aria-hidden />
      </button>

      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Sparkles className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-sm">
          <span className="font-medium">AI generated</span> this board — review
          it, then keep it or start over.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2 pl-6 sm:pl-0">
        <Button
          size="sm"
          variant="default"
          onClick={handleKeep}
          disabled={isPending}
          aria-label="Keep this board"
        >
          <CheckCircle className="size-3.5" aria-hidden />
          Keep
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRegenerate}
          disabled={isPending}
          aria-label="Regenerate board with AI"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Regenerate
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={handleDiscard}
          disabled={isPending}
          aria-label="Discard this board"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Discard
        </Button>
      </div>

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
