"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Kind = "bug" | "feature_request";

type Props = {
  submit: (input: {
    kind: Kind;
    title: string;
    body: string;
  }) => Promise<
    { ok: true; data: { id: string } } | { ok: false; error: string }
  >;
  onDone: (id: string) => void;
};

export function SubmitFeedbackForm({ submit, onDone }: Props) {
  const [kind, setKind] = useState<Kind>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await submit({
        kind,
        title: title.trim(),
        body: body.trim(),
      });
      if (result.ok) {
        onDone(result.data.id);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Kind toggle */}
      <div className="border-border bg-muted/40 flex gap-1 rounded-md border p-0.5">
        <button
          type="button"
          onClick={() => setKind("bug")}
          className={cn(
            "flex-1 rounded-[calc(var(--radius-md)-2px)] px-3 py-1 text-xs font-medium transition-all",
            kind === "bug"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Bug
        </button>
        <button
          type="button"
          onClick={() => setKind("feature_request")}
          className={cn(
            "flex-1 rounded-[calc(var(--radius-md)-2px)] px-3 py-1 text-xs font-medium transition-all",
            kind === "feature_request"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Feature
        </button>
      </div>

      {/* Title */}
      <Input
        placeholder="Title — briefly describe the issue"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={isPending}
        maxLength={120}
      />

      {/* Body */}
      <Textarea
        placeholder="What happened, or what you'd like to see…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={isPending}
        className="min-h-24 resize-none"
        maxLength={2000}
      />

      {/* Error. Whole-form, not per-field: submitFeedback fails on auth, org
          membership or the insert, so there is no single control to describe.
          It only needs announcing when it appears. */}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}

      {/* Submit */}
      <Button
        type="button"
        size="sm"
        disabled={isPending || !title.trim() || !body.trim()}
        onClick={handleSubmit}
        className="self-end"
      >
        {isPending ? "Submitting…" : "Submit"}
      </Button>
    </div>
  );
}
