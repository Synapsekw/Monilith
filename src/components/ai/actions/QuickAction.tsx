"use client";
import { useState, useTransition } from "react";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Kicker } from "@/components/ui/kicker";
import { proposeActions, executeActions } from "@/lib/ai/write/actions";
import { ActionConfirmCard, type ConfirmState } from "./ActionConfirmCard";
import type { ValidatedAction } from "@/lib/ai/write/schema";

const MIN = 3;

/**
 * ⌘K quick-action composer: textarea → propose (thinking) → confirm card(s) or
 * a clarification → Approve executes via the shared engine. All client state —
 * no RSC navigation. Mounted lazily inside the command palette (Task 9).
 */
export function QuickAction({ onClose }: { onClose: () => void }) {
  const [instruction, setInstruction] = useState("");
  const [actions, setActions] = useState<ValidatedAction[]>([]);
  const [clarification, setClarification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ConfirmState>("idle");
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reset() {
    setActions([]);
    setClarification(null);
    setError(null);
    setNote(null);
    setState("idle");
  }

  function run() {
    const text = instruction.trim();
    if (text.length < MIN || pending) return;
    reset();
    start(async () => {
      const res = await proposeActions({ instruction: text });
      if (!res.ok) return setError(res.error);
      if (res.data.actions.length === 0)
        return setClarification(
          res.data.clarification ?? "I couldn't work that out.",
        );
      setActions(res.data.actions);
    });
  }

  function approve() {
    if (pending) return;
    setState("running");
    setError(null);
    start(async () => {
      const res = await executeActions({ actions });
      if (!res.ok) {
        setState("error");
        setNote(res.error);
        return;
      }
      const failed = res.data.results.find((r) => !r.ok);
      if (failed && !failed.ok) {
        setState("error");
        setNote(failed.error);
        return;
      }
      const created = res.data.results.find((r) => r.ok && r.itemId);
      setState("done");
      setNote(
        created && created.ok && created.itemId
          ? "Created — open it from the board."
          : "Done.",
      );
    });
  }

  const busyProposing = pending && actions.length === 0 && state === "idle";

  return (
    <div className="flex flex-col gap-3 p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="flex flex-col gap-2"
      >
        <Kicker>Run a command</Kicker>
        <Textarea
          autoFocus
          rows={2}
          value={instruction}
          disabled={pending}
          aria-label="Command"
          placeholder="e.g. create task Ship v2 due Friday for Dana in Backlog"
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
        />
        <div className="flex items-center justify-end gap-2">
          <span className="text-kicker text-xs">⌘↵ to run</span>
          <Button
            type="submit"
            size="sm"
            disabled={instruction.trim().length < MIN || pending}
          >
            <Wand2 className="size-3.5" />
            {busyProposing ? "Working…" : "Run"}
          </Button>
        </div>
      </form>

      {actions.map((a, i) => (
        <ActionConfirmCard
          key={i}
          action={a}
          state={state}
          resultNote={note ?? undefined}
          onApprove={approve}
          onCancel={onClose}
        />
      ))}

      {clarification ? (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {clarification}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
