"use client";

import { useBoardPresenceContextOptional } from "@/lib/boards/presence-context";
import { cn } from "@/lib/utils";

/**
 * An overlay indicator showing that other user(s) are currently focused on
 * (editing) the host element identified by `target` (e.g. a cell or card).
 *
 * Presentational only — render it inside a `position: relative` host; it pins
 * itself to the host's edges and draws a per-user colored ring. The per-user
 * `color` is presence data (like a status color), so it's applied inline.
 */
export function PresenceRing({
  target,
  className,
}: {
  target: string;
  className?: string;
}) {
  const presence = useBoardPresenceContextOptional();
  if (!presence) return null;
  const { focusMap, selfUserId } = presence;
  const others = (focusMap.get(target) ?? []).filter((o) => o.userId !== selfUserId);
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
      className={cn("pointer-events-none absolute inset-0 z-10 rounded-md", className)}
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
}
