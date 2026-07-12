"use client";
import { AlertTriangle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import type { ValidatedAction } from "@/lib/ai/write/schema";

export type ConfirmState = "idle" | "running" | "done" | "error";

/**
 * Reusable confirm-before-execute card. Renders the server-derived `summary`
 * and any `warnings`, plus Approve/Cancel. `state` drives the button labels and
 * the post-execute result note. Exported for the Ask-full-page track to render
 * the identical card in its thread.
 */
export function ActionConfirmCard({
  action,
  onApprove,
  onCancel,
  state,
  resultNote,
}: {
  action: ValidatedAction;
  onApprove: () => void;
  onCancel: () => void;
  state: ConfirmState;
  resultNote?: string;
}) {
  const showActions = state === "idle" || state === "running";
  return (
    <div
      role="group"
      aria-label="Proposed action"
      className="bg-surface hover:border-border-hover rounded-lg border p-3 text-sm transition-colors"
    >
      <Kicker>Proposed action</Kicker>
      <p className="text-foreground mt-1.5 font-medium">{action.summary}</p>

      {action.warnings.map((w) => (
        <p
          key={w}
          className="text-muted-foreground mt-1.5 flex items-start gap-1.5 text-xs"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{w}</span>
        </p>
      ))}

      {resultNote ? (
        <p
          aria-live="polite"
          className={`mt-2 text-xs ${state === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {resultNote}
        </p>
      ) : null}

      {showActions ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={state === "running"}
          >
            <X className="size-3.5" /> Cancel
          </Button>
          <Button size="sm" onClick={onApprove} disabled={state === "running"}>
            <Check className="size-3.5" />
            {state === "running" ? "Applying…" : "Approve"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
