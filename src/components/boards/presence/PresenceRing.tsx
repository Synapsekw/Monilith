"use client";

import { memo } from "react";
import { usePresenceFocusStore } from "@/lib/boards/presence-focus-store";
import { cn } from "@/lib/utils";

/**
 * An overlay indicator showing that other user(s) are currently focused on
 * (editing) the host element identified by `target` (e.g. a cell or card).
 *
 * Presentational only — render it inside a `position: relative` host; it pins
 * itself to the host's edges and draws a per-user colored ring. The per-user
 * `color` is presence data (like a status color), so it's applied inline.
 *
 * Subscribes to the presence focus store with a per-target selector, so on a
 * remote heartbeat only the cell whose occupant set changed re-renders (a cell
 * nobody is editing selects `undefined` → stable → no re-render). `memo` keeps
 * it from re-rendering when its parent row re-renders with the same props.
 */
export const PresenceRing = memo(function PresenceRing({
  target,
  className,
}: {
  target: string;
  className?: string;
}) {
  const occupants = usePresenceFocusStore((s) => s.focusMap.get(target));
  const selfUserId = usePresenceFocusStore((s) => s.selfUserId);
  const others = (occupants ?? []).filter((o) => o.userId !== selfUserId);
  if (others.length === 0) return null;

  const first = others[0];
  const label =
    others.length === 1
      ? `${first.name} is editing`
      : `${first.name} and ${others.length - 1} other${others.length - 1 > 1 ? "s" : ""} are editing`;

  return (
    <span
      aria-label={label}
      title={others.map((o) => o.name).join(", ")}
      className={cn(
        "pointer-events-none absolute inset-0 z-10 rounded-md",
        className,
      )}
      // Per-user presence color drawn as an inset ring (data-driven, like a
      // status color); chrome stays monochrome.
      style={{ boxShadow: `inset 0 0 0 2px ${first.color}` }}
    >
      {others.length > 1 ? (
        <span
          className="absolute -top-2 -right-2 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold text-white tabular-nums shadow-sm"
          style={{ backgroundColor: first.color }}
        >
          {others.length}
        </span>
      ) : null}
    </span>
  );
});
