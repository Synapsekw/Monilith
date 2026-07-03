"use client";

import type { ColumnOption } from "@/lib/validations/boards";
import { pillTextColor } from "@/lib/boards/contrast";

/**
 * Trailing "Clear" affordance shared by the selector editors (Status /
 * Dropdown / People / Date) and the ItemQuickEdit peek. Clearing deletes the
 * cell value; callers without a clear path fall back to dismissing.
 */
export function ClearOptionButton({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="text-muted-foreground hover:bg-accent focus-visible:ring-ring inline-flex items-center justify-center rounded-md px-2 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:h-11"
    >
      Clear
    </button>
  );
}

/**
 * The status option pills + Clear — the single source of truth for how a
 * status value is picked, shared by the table's StatusEditor (inside its
 * PopoverSurface) and the ItemQuickEdit peek (inside its own popover).
 */
export function StatusOptionList({
  options,
  selected,
  onSelect,
  onClear,
}: {
  options: ColumnOption[];
  selected: string | null;
  onSelect: (optionId: string) => void;
  onClear: () => void;
}) {
  return (
    <>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="option"
          aria-selected={selected === o.id}
          onClick={() => onSelect(o.id)}
          className="focus-visible:ring-ring inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11"
          style={{ backgroundColor: o.color, color: pillTextColor(o.color) }}
        >
          {o.label}
        </button>
      ))}
      <ClearOptionButton onClear={onClear} />
    </>
  );
}

export type PercentParse =
  | { kind: "clear" }
  | { kind: "invalid" }
  | { kind: "commit"; percent: number };

/**
 * Shared percent-input semantics (the table's PercentEditor and the quick-edit
 * peek both call this so behavior can never drift): empty → clear the cell;
 * NaN → invalid (revert); otherwise clamp 0..100 so a fat-fingered 150 still
 * commits a sensible value.
 */
export function parsePercentInput(raw: string): PercentParse {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "clear" };
  const n = Number(trimmed);
  if (Number.isNaN(n)) return { kind: "invalid" };
  return { kind: "commit", percent: Math.max(0, Math.min(100, n)) };
}
