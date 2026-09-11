"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  Action,
  Suggestion,
  SuggestionKind,
} from "@/lib/ai/board-intelligence/runs";
import { cn } from "@/lib/utils";

/**
 * The card's only colour, and the same mapping the strip uses for the same
 * five signals — a suggestion about overdue work must not read as a different
 * kind of red from the chip that counts it.
 */
const DOT: Record<SuggestionKind, string> = {
  overdue: "bg-status-red",
  blocked: "bg-status-orange",
  overloaded: "bg-status-yellow",
  stalled: "bg-status-gray",
  changed: "bg-primary",
  other: "bg-muted-foreground/60",
};

/** A `filter` only changes what the reader is LOOKING at, so everyone gets it;
 *  everything else writes to the board and is editors-only. */
const isWrite = (action: Action) => action.type !== "filter";

/**
 * One thing to do, with the rows it was read from.
 *
 * The evidence is a popover rather than always-on text on purpose: the card has
 * to be scannable at 320px, and the reader who doubts a suggestion is the one
 * who asks "why?" — not everyone, every time.
 */
export function SuggestionCard({
  suggestion,
  canApply,
  onApply,
  onDismiss,
}: {
  suggestion: Suggestion;
  canApply: boolean;
  onApply: (actionIndex: number) => void;
  onDismiss: () => void;
}) {
  const titleId = useId();
  const [primary, secondary] = suggestion.actions;

  return (
    <li
      aria-labelledby={titleId}
      className="bg-surface border-border hover:border-border-hover ease-keystone rounded-lg border p-3 transition-colors"
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 size-1.5 shrink-0 rounded-full",
            DOT[suggestion.kind],
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p id={titleId} className="text-sm font-medium">
            {suggestion.title}
          </p>
          {suggestion.evidence ? (
            <Kicker size="xs">{suggestion.evidence}</Kicker>
          ) : null}
          <p className="text-muted-foreground text-xs">{suggestion.body}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {primary && (canApply || !isWrite(primary)) ? (
              <Button size="xs" onClick={() => onApply(0)}>
                {primary.label}
              </Button>
            ) : null}
            {secondary && (canApply || !isWrite(secondary)) ? (
              <Button size="xs" variant="ghost" onClick={() => onApply(1)}>
                {secondary.label}
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
            {suggestion.evidenceRows.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="xs" variant="link">
                    why?
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-2">
                  <ul className="text-xs">
                    {suggestion.evidenceRows.map((row) => (
                      <li key={row.itemId} className="truncate py-0.5">
                        {row.detail ? `${row.name} · ${row.detail}` : row.name}
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
