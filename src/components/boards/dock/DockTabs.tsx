"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { DockTab } from "@/stores/board-intelligence";

/** Tab order is also the arrow-key order — one list, not two. */
const TABS: readonly { id: DockTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "intelligence", label: "Intelligence" },
] as const;

/**
 * The dock's two sections.
 *
 * Pill tabs, same recipe as the item panel's (`ItemPanel.tsx`): hairlines that
 * brighten rather than thicken, no icon, and the ONLY colour is the accent
 * count of unresolved suggestions.
 *
 * Arrow keys move from the FOCUSED tab, not from `value`. The component is
 * controlled, so a parent that ignores `onChange` would otherwise pin every
 * arrow press to the same origin — and the two reads disagree for exactly one
 * frame on every real switch, which is the frame the user is pressing in.
 */
export function DockTabs({
  value,
  onChange,
  badge,
}: {
  value: DockTab;
  onChange: (t: DockTab) => void;
  badge: number;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const focused = refs.current.findIndex(
      (el) => el === document.activeElement,
    );
    const from =
      focused === -1 ? TABS.findIndex((t) => t.id === value) : focused;
    let next: number;
    if (e.key === "ArrowRight") next = (from + 1) % TABS.length;
    else if (e.key === "ArrowLeft")
      next = (from - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(TABS[next].id);
  };

  return (
    <div
      role="tablist"
      aria-label="Dock sections"
      onKeyDown={move}
      className="flex min-w-0 flex-1 gap-1"
    >
      {TABS.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`dock-tab-${t.id}`}
            // Only the OPEN section is mounted, so only the selected tab has a
            // panel to point at — `aria-controls` naming an id that is not in
            // the document is a dangling reference, not a relationship.
            aria-controls={selected ? `dock-panel-${t.id}` : undefined}
            aria-selected={selected}
            // Roving tabindex: the tablist is ONE tab stop, and the arrow keys
            // are what move within it.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "focus-visible:ring-ring ease-keystone h-7 shrink-0 rounded-full border px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11",
              selected
                ? "bg-surface-muted border-border-bright text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:border-border border-transparent",
            )}
          >
            {t.label}
            {t.id === "intelligence" && badge > 0 ? (
              <span className="text-primary ml-1 tabular-nums">{badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
