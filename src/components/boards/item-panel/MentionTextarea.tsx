"use client";

import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  activeMentionQuery,
  applyMention,
  type MentionTarget,
} from "@/lib/collaboration/mentions";

export function MentionTextarea({
  value,
  mentionIds,
  members,
  onChange,
}: {
  value: string;
  mentionIds: string[];
  members: readonly MentionTarget[];
  onChange: (text: string, mentionIds: string[]) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ query: string; start: number } | null>(
    null,
  );

  function recompute(text: string, caret: number) {
    setQuery(activeMentionQuery(text, caret));
  }

  const suggestions = query
    ? members
        .filter((m) =>
          (m.fullName ?? "").toLowerCase().includes(query.query.toLowerCase()),
        )
        .slice(0, 6)
    : [];

  function choose(m: MentionTarget) {
    const ta = ref.current;
    const caret = ta?.selectionStart ?? value.length;
    const { text } = applyMention(value, caret, m);
    setQuery(null);
    onChange(text, [...new Set([...mentionIds, m.userId])]);
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
          onChange(e.target.value, mentionIds);
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
          {suggestions.map((m) => (
            <li key={m.userId}>
              <button
                type="button"
                className="hover:bg-accent w-full px-3 py-1.5 text-left text-sm"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(m);
                }}
              >
                {m.fullName ?? "Someone"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
