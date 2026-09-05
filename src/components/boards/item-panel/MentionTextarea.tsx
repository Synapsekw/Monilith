"use client";

import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  activeMentionQuery,
  applyMention,
  mentionLabel,
  type MentionTarget,
} from "@/lib/collaboration/mentions";
import type { MentionTargetInput } from "@/lib/validations/collaboration-actions";

/** The tagged id a chosen target contributes to the submitted mention list. */
function targetId(target: MentionTarget): MentionTargetInput {
  return target.kind === "agent"
    ? { kind: "agent", agentId: target.agentId }
    : { kind: "user", userId: target.userId };
}

function targetKey(target: MentionTarget): string {
  return target.kind === "agent"
    ? `agent:${target.agentId}`
    : `user:${target.userId}`;
}

export function MentionTextarea({
  value,
  mentions,
  targets,
  onChange,
}: {
  value: string;
  mentions: MentionTargetInput[];
  /** People AND the author's own agents — filtering is pure client state, so a
   *  keystroke costs zero server round-trips. */
  targets: readonly MentionTarget[];
  onChange: (text: string, mentions: MentionTargetInput[]) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Seeded from the initial value so a textarea mounted mid-token (reopened
  // draft) shows its suggestions immediately, not only after the next keystroke.
  const [query, setQuery] = useState<{ query: string; start: number } | null>(
    () => activeMentionQuery(value, value.length),
  );

  function recompute(text: string, caret: number) {
    setQuery(activeMentionQuery(text, caret));
  }

  const suggestions = query
    ? targets
        .filter((t) =>
          mentionLabel(t)
            .slice(1)
            .toLowerCase()
            .includes(query.query.toLowerCase()),
        )
        .slice(0, 6)
    : [];

  function choose(target: MentionTarget) {
    const ta = ref.current;
    // Derive the caret from the query that produced this suggestion rather than
    // the live DOM selection: a mouseDown on the list can land before the
    // textarea has ever been given a caret, and `selectionStart` is then 0 —
    // which would splice the mention in at the START of the draft.
    const caret = query
      ? query.start + 1 + query.query.length
      : (ta?.selectionStart ?? value.length);
    const { text } = applyMention(value, caret, target);
    setQuery(null);
    const next = [...mentions, targetId(target)];
    const deduped = next.filter(
      (m, i) =>
        next.findIndex((x) => JSON.stringify(x) === JSON.stringify(m)) === i,
    );
    onChange(text, deduped);
    queueMicrotask(() => ta?.focus());
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        rows={3}
        autoFocus
        onChange={(e) => {
          onChange(e.target.value, mentions);
          recompute(
            e.target.value,
            e.target.selectionStart ?? e.target.value.length,
          );
        }}
        onKeyUp={(e) =>
          recompute(
            (e.target as HTMLTextAreaElement).value,
            (e.target as HTMLTextAreaElement).selectionStart ?? 0,
          )
        }
      />
      {suggestions.length > 0 && (
        <ul className="bg-surface border-border absolute z-50 mt-1 w-64 overflow-hidden rounded-lg border shadow-md">
          {suggestions.map((t) => (
            <li key={targetKey(t)}>
              <button
                type="button"
                className="hover:bg-state-hover flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(t);
                }}
              >
                <span className="truncate">{mentionLabel(t)}</span>
                {t.kind === "agent" && (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {t.name}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
