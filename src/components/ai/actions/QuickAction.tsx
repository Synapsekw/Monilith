"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Kicker } from "@/components/ui/kicker";
import { proposeActions, executeActions } from "@/lib/ai/write/actions";
import { ActionConfirmCard, type ConfirmState } from "./ActionConfirmCard";
import type {
  ValidatedAction,
  AiConversationTurn,
} from "@/lib/ai/write/schema";

const MIN = 3;

type DisplayTurn = { role: "you" | "ai"; text: string };

/** Three pulsing dots — a live "the model is thinking" signal. */
function WorkingDots() {
  return (
    <span className="flex gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="bg-muted-foreground/60 size-1.5 animate-pulse rounded-full"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * ⌘K quick-action composer — a multi-turn clarification loop. The user's
 * command and the model's questions stack into a mini transcript; the same box
 * at the bottom is the reply box. Each turn threads the opaque Anthropic
 * transcript back so the model continues rather than restarts, until it can
 * propose a concrete action (confirm card) or the user cancels. All client
 * state — no RSC navigation.
 */
export function QuickAction({ onClose }: { onClose: () => void }) {
  const [instruction, setInstruction] = useState("");
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [history, setHistory] = useState<AiConversationTurn[]>([]);
  const [actions, setActions] = useState<ValidatedAction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [state, setState] = useState<ConfirmState>("idle");
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // Refocus the reply box whenever the model asks a follow-up.
  useEffect(() => {
    if (!thinking && !actions.length && turns.at(-1)?.role === "ai")
      boxRef.current?.focus();
  }, [thinking, actions.length, turns]);

  function run() {
    const text = instruction.trim();
    if (text.length < MIN || pending) return;
    setTurns((prev) => [...prev, { role: "you", text }]);
    setInstruction("");
    setError(null);
    setThinking(true);
    start(async () => {
      const res = await proposeActions({ instruction: text, history });
      setThinking(false);
      if (!res.ok) return setError(res.error);
      setHistory(res.data.history ?? []);
      if (res.data.actions.length > 0) return setActions(res.data.actions);
      setTurns((prev) => [
        ...prev,
        {
          role: "ai",
          text: res.data.clarification ?? "I couldn't work that out.",
        },
      ]);
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

  return (
    <div className="flex flex-col gap-3 p-3">
      <Kicker>Run a command</Kicker>

      {turns.length > 0 ? (
        <div className="divide-border bg-surface-sunken flex flex-col divide-y rounded-lg border">
          {turns.map((t, i) => (
            <div key={i} className="flex flex-col gap-1 p-2.5">
              <span className="text-kicker font-mono text-[11px] tracking-[0.12em] uppercase">
                {t.role === "you" ? "You" : "Pulse"}
              </span>
              <p className="text-foreground text-sm whitespace-pre-wrap">
                {t.text}
              </p>
            </div>
          ))}
          {thinking ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 p-2.5"
            >
              <WorkingDots />
              <span className="text-muted-foreground text-sm">
                Pulse is working…
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

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

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {actions.length === 0 ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="flex flex-col gap-2"
        >
          <Textarea
            ref={boxRef}
            autoFocus
            rows={2}
            value={instruction}
            disabled={thinking}
            aria-label="Command"
            placeholder={
              turns.length
                ? "Reply…"
                : "e.g. create task Ship v2 due Friday for Dana in Backlog"
            }
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
              disabled={instruction.trim().length < MIN || thinking}
            >
              <Wand2 className="size-3.5" />
              {thinking ? "Working…" : "Run"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
