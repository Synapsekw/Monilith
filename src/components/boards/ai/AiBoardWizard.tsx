"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, ArrowLeft, RefreshCw } from "lucide-react";

import {
  generateBoardProposal,
  createBoardFromProposal,
} from "@/lib/ai/board-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FieldStatus, useFieldStatus } from "@/components/ui/field-status";
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";
import { Kicker } from "@/components/ui/kicker";

type Step = "describe" | "generating" | "review";

type Proposal = {
  name: string;
  templatePayload: unknown;
  summary: {
    groups: number;
    columns: { name: string; kind: string }[];
    items: number;
  };
  warnings: string[];
};

/**
 * F10 — AI board generation. describe → generate → review → create. The proposal
 * is returned by the action but NEVER persisted until the human clicks "Create
 * board" (the approval gate). Mirrors AiDashboardWizard.
 */
export function AiBoardWizard({
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
  const hintId = useId();

  const [step, setStep] = useState<Step>("describe");
  const [prompt, setPrompt] = useState("");
  const [feedback, setFeedback] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A failed generate drops the user back on the describe step, so the failure
  // is the prompt field's business: it becomes the textarea's accessible
  // description alongside the standing "only your description is sent" hint.
  const status = useFieldStatus(error, "error", hintId);
  // "Create board" disables itself for the duration of the transition and stays
  // mounted when the create FAILS (the dialog only closes on success), so
  // without this the keyboard user is dumped on <body> next to the error.
  const createRef = useRestoreFocusAfterPending<HTMLButtonElement>(isPending);

  function generate(withFeedback?: string) {
    if (prompt.trim().length < 3) return;
    setError(null);
    setStep("generating");
    startTransition(async () => {
      const res = await generateBoardProposal({
        workspaceId,
        prompt: prompt.trim(),
        feedback: withFeedback?.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        setStep("describe");
        return;
      }
      setProposal(res.data.proposal);
      setStep("review");
    });
  }

  function create() {
    if (!proposal) return;
    setError(null);
    startTransition(async () => {
      const res = await createBoardFromProposal({
        workspaceId,
        proposal: {
          name: proposal.name,
          templatePayload: proposal.templatePayload,
        },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/boards/${res.data.boardId}?review=1`);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-primary size-4" aria-hidden />
            Generate a board with AI
          </DialogTitle>
          <DialogDescription>
            {step === "review"
              ? "Review the proposed board, then create it."
              : "Describe the board you want and we'll design a starter for you."}
          </DialogDescription>
        </DialogHeader>

        {step === "describe" ? (
          <div className="flex flex-col gap-2">
            <Textarea
              aria-label="Describe the board to generate"
              placeholder="Build me a board for tracking a product launch — tasks, owners, status, and deadlines."
              value={prompt}
              maxLength={2000}
              rows={4}
              onChange={(e) => setPrompt(e.target.value)}
              {...status.controlProps}
            />
            <p id={hintId} className="text-muted-foreground text-xs">
              Only your description is sent — no workspace data leaves.
            </p>
          </div>
        ) : null}

        {step === "generating" ? (
          <div className="text-muted-foreground flex flex-col items-center gap-3 py-8 text-sm">
            <Loader2 className="text-primary size-6 animate-spin" aria-hidden />
            Designing your board…
          </div>
        ) : null}

        {step === "review" && proposal ? (
          <ReviewStep
            proposal={proposal}
            feedback={feedback}
            onFeedback={setFeedback}
          />
        ) : null}

        <FieldStatus field={status} className="text-sm" />

        <DialogFooter>
          {step === "describe" ? (
            <Button
              type="button"
              onClick={() => generate()}
              disabled={isPending || prompt.trim().length < 3}
            >
              <Sparkles className="size-3.5" aria-hidden />
              Generate
            </Button>
          ) : null}

          {step === "review" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setError(null);
                  setStep("describe");
                }}
                disabled={isPending}
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Back
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => generate(feedback)}
                disabled={isPending}
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Regenerate
              </Button>
              <Button
                ref={createRef}
                type="button"
                onClick={create}
                disabled={isPending}
              >
                {isPending ? "Creating…" : "Create board"}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewStep({
  proposal,
  feedback,
  onFeedback,
}: {
  proposal: Proposal;
  feedback: string;
  onFeedback: (v: string) => void;
}) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <Kicker>Proposed board</Kicker>
        <div className="text-base font-bold">{proposal.name}</div>
        <div className="text-muted-foreground text-xs">
          {proposal.summary.groups} groups · {proposal.summary.columns.length}{" "}
          columns · {proposal.summary.items} starter items
        </div>
      </div>

      <div>
        <div className="text-muted-foreground mb-1.5 text-xs">Columns</div>
        <div className="flex flex-wrap gap-1.5">
          {proposal.summary.columns.map((c) => (
            <span
              key={`${c.name}-${c.kind}`}
              className="bg-surface-muted text-muted-foreground inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs"
            >
              <span className="text-foreground">{c.name}</span>
              <span>· {c.kind}</span>
            </span>
          ))}
        </div>
      </div>

      {proposal.warnings.length > 0 ? (
        <ul className="text-muted-foreground list-inside list-disc text-xs">
          {proposal.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="ai-board-feedback"
          className="text-muted-foreground text-xs"
        >
          Not quite right? Add a note and regenerate.
        </label>
        <Textarea
          id="ai-board-feedback"
          placeholder="e.g. add a priority column and a QA group"
          value={feedback}
          maxLength={2000}
          rows={2}
          onChange={(e) => onFeedback(e.target.value)}
        />
      </div>
    </div>
  );
}
