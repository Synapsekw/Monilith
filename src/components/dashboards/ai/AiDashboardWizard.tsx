"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Sparkles } from "lucide-react";

import {
  listAiBoards,
  getBoardSnapshotSummary,
  generateDashboardProposal,
  createDashboardFromProposal,
} from "@/lib/ai/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Step = "pick" | "approve" | "generating";

type AiBoard = { id: string; name: string; workspaceId: string };
type Summary = {
  boardName: string;
  rowCount: number;
  columns: { name: string; kind: string }[];
  estimatedTokens: number;
};

/** Rough byte estimate for the payload size shown to the user (≈4 chars/token). */
function formatPayloadSize(tokens: number): string {
  const bytes = tokens * 4;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function AiDashboardWizard({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [step, setStep] = useState<Step>("pick");
  const [boards, setBoards] = useState<AiBoard[]>([]);
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the board list when the dialog opens. State resets naturally because
  // the parent unmounts this component on close (no setState-in-effect needed).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    startTransition(async () => {
      const res = await listAiBoards();
      if (cancelled) return;
      if (!res.ok) {
        setBoardsError(res.error);
        return;
      }
      setBoards(res.data.boards);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function goToApprove() {
    if (!boardId) return;
    setError(null);
    setStep("approve");
    startTransition(async () => {
      const res = await getBoardSnapshotSummary({ boardId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSummary(res.data);
    });
  }

  function generate() {
    if (!boardId) return;
    setError(null);
    setStep("generating");
    startTransition(async () => {
      const gen = await generateDashboardProposal({ boardId });
      if (!gen.ok) {
        setError(gen.error);
        return;
      }
      const created = await createDashboardFromProposal({
        workspaceId,
        proposal: { ...gen.data.proposal, sourceBoardId: boardId },
      });
      if (!created.ok) {
        setError(created.error);
        return;
      }
      router.push(`/dashboards/${created.data.dashboardId}?review=1`);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-brand size-4" />
            Generate with AI
          </DialogTitle>
          <DialogDescription>
            {step === "pick"
              ? "Pick a board and we'll design a dashboard from it."
              : step === "approve"
                ? "Review what we'll send before generating."
                : "Designing your dashboard…"}
          </DialogDescription>
        </DialogHeader>

        {step === "pick" ? (
          <PickStep
            boards={boards}
            boardsError={boardsError}
            selectedId={boardId}
            onSelect={setBoardId}
            loading={isPending && boards.length === 0}
          />
        ) : null}

        {step === "approve" ? (
          <ApproveStep summary={summary} error={error} loading={isPending} />
        ) : null}

        {step === "generating" ? <GeneratingStep error={error} /> : null}

        <DialogFooter>
          {step === "pick" ? (
            <Button
              type="button"
              onClick={goToApprove}
              disabled={!boardId || isPending}
            >
              Next
            </Button>
          ) : null}

          {step === "approve" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setError(null);
                  setStep("pick");
                }}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={generate}
                disabled={isPending || !!error}
              >
                Generate
              </Button>
            </>
          ) : null}

          {step === "generating" && error ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setError(null);
                  setStep("approve");
                }}
              >
                Back
              </Button>
              <Button type="button" onClick={generate}>
                Retry
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PickStep({
  boards,
  boardsError,
  selectedId,
  onSelect,
  loading,
}: {
  boards: AiBoard[];
  boardsError: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  if (boardsError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {boardsError}
      </p>
    );
  }
  if (loading) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        Loading boards…
      </p>
    );
  }
  if (boards.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        No boards available to build from.
      </p>
    );
  }
  return (
    <div
      role="radiogroup"
      aria-label="Choose a board"
      className="-mx-1 max-h-72 space-y-1 overflow-y-auto px-1 py-1"
    >
      {boards.map((b) => {
        const selected = b.id === selectedId;
        return (
          <button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(b.id)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              selected
                ? "border-primary bg-accent text-foreground"
                : "bg-surface text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="min-w-0 truncate">{b.name}</span>
            {selected ? <Check className="text-brand size-4 shrink-0" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function ApproveStep({
  summary,
  error,
  loading,
}: {
  summary: Summary | null;
  error: string | null;
  loading: boolean;
}) {
  if (error) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {error}
      </p>
    );
  }
  if (!summary || loading) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        Reading board…
      </p>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      <div className="bg-surface flex flex-wrap gap-x-6 gap-y-1 rounded-md border p-3">
        <div>
          <div className="text-muted-foreground text-xs">Board</div>
          <div className="font-medium">{summary.boardName}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Rows</div>
          <div className="font-medium">{summary.rowCount}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Payload</div>
          <div className="font-medium">
            {formatPayloadSize(summary.estimatedTokens)}
          </div>
        </div>
      </div>

      <div>
        <div className="text-muted-foreground mb-1.5 text-xs">
          Columns ({summary.columns.length})
        </div>
        <div className="flex flex-wrap gap-1.5">
          {summary.columns.map((c) => (
            <span
              key={c.name}
              className="bg-surface-muted text-muted-foreground inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
            >
              <span className="text-foreground">{c.name}</span>
              <span className="text-muted-foreground">· {c.kind}</span>
            </span>
          ))}
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        Only column names, types, option labels, and summary counts are sent —
        no cell contents leave your workspace.
      </p>
    </div>
  );
}

function GeneratingStep({ error }: { error: string | null }) {
  if (error) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {error}
      </p>
    );
  }
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-3 py-8 text-sm">
      <Loader2 className="text-brand size-6 animate-spin" />
      Designing your dashboard…
    </div>
  );
}
