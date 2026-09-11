"use client";

import { X } from "lucide-react";
import { Kicker } from "@/components/ui/kicker";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/boards/automation-runs";
import { useBoardIntelligenceOptional } from "@/lib/boards/intelligence/context";
import {
  selectionEquals,
  signalSelection,
  stripSignals,
} from "@/lib/boards/intelligence/signals";
import type {
  IntelSelection,
  Signal,
  SignalTone,
} from "@/lib/boards/intelligence/types";

/**
 * The Intelligence strip (spec §2.1, Phase 1): mono kicker, up to MAX_CHIPS
 * hairline chips, a zero-state line, "✕ clear" while a chip is active, and
 * skeleton pills while the cache hydrates. No AI badge, no glow, no sparkle
 * (decision 27 / pulse-ui). Chip click is a URL-mirrored client filter — zero
 * server round-trips. "Catch me up" and "updated Xm ago" are Phase 2.
 */

/** 6px dot per tone. Static strings so Tailwind emits them. */
const DOT: Record<SignalTone, string> = {
  red: "bg-status-red",
  orange: "bg-status-orange",
  yellow: "bg-status-yellow",
  gray: "bg-status-gray",
  accent: "bg-primary",
};

export type StripViewProps = {
  signals: Signal[];
  selection: IntelSelection | null;
  activeSignal: Signal | null;
  lastChangeAt: string | null;
  nowMs: number;
  loading: boolean;
  onToggle: (signal: Signal) => void;
  onClear: () => void;
};

function zeroStateText(lastChangeAt: string | null, nowMs: number): string {
  const base = "All on track · nothing overdue";
  return lastChangeAt
    ? `${base} · last change ${timeAgo(lastChangeAt, nowMs)}`
    : base;
}

function chipKey(s: Signal): string {
  const sel = signalSelection(s);
  return sel.subject ? `${sel.kind}:${sel.subject}` : sel.kind;
}

function SignalChip({
  signal,
  active,
  onClick,
}: {
  signal: Signal;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "border-border hover:border-border-hover focus-visible:ring-ring ease-keystone inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:h-11",
        active && "border-primary bg-primary/10",
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", DOT[signal.tone])}
      />
      <span className="font-mono tabular-nums">{signal.count}</span>
      <span className="text-muted-foreground">{signal.label}</span>
    </button>
  );
}

export function IntelligenceStripView({
  signals,
  selection,
  activeSignal,
  lastChangeAt,
  nowMs,
  loading,
  onToggle,
  onClear,
}: StripViewProps) {
  // Zero-count chips are hidden (the engine already drops them; this is the
  // belt to that brace) and the strip shows at most MAX_CHIPS.
  const chips = stripSignals(signals.filter((s) => s.count > 0));
  return (
    <div
      role="toolbar"
      aria-label="Intelligence"
      className="flex h-8 shrink-0 items-center gap-2 overflow-x-auto px-6"
    >
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          aria-hidden
          className="bg-muted-foreground/60 size-1.5 shrink-0 rounded-full"
        />
        <Kicker size="xs">Intelligence</Kicker>
      </span>

      {loading ? (
        <span
          className="flex items-center gap-1.5"
          role="status"
          aria-busy="true"
          aria-label="Loading intelligence"
        >
          <Skeleton className="h-5 w-20 rounded-sm" />
          <Skeleton className="h-5 w-24 rounded-sm" />
          <Skeleton className="h-5 w-16 rounded-sm" />
        </span>
      ) : chips.length === 0 ? (
        <span className="text-muted-foreground truncate text-xs">
          {zeroStateText(lastChangeAt, nowMs)}
        </span>
      ) : (
        chips.map((s) => (
          <SignalChip
            key={chipKey(s)}
            signal={s}
            active={
              activeSignal !== null &&
              selectionEquals(signalSelection(activeSignal), signalSelection(s))
            }
            onClick={() => onToggle(s)}
          />
        ))
      )}

      {selection !== null && !loading ? (
        <button
          type="button"
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground hover:bg-state-hover focus-visible:ring-ring ease-keystone inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:h-11"
        >
          <X className="size-3" aria-hidden />
          clear
        </button>
      ) : null}
    </div>
  );
}

/** Connected strip: reads the board's provider; renders nothing without one. */
export function IntelligenceStrip() {
  const intel = useBoardIntelligenceOptional();
  if (!intel) return null;
  return (
    <IntelligenceStripView
      signals={intel.signals}
      selection={intel.selection}
      activeSignal={intel.activeSignal}
      lastChangeAt={intel.lastChangeAt}
      nowMs={intel.nowMs}
      loading={intel.loading}
      onToggle={intel.toggle}
      onClear={intel.clear}
    />
  );
}
