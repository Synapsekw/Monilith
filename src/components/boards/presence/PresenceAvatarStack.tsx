"use client";

import Image from "next/image";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RosterOccupant } from "@/lib/boards/presence-types";

/**
 * Overlapping avatar stack — pure presentational. Faces are capped at
 * `maxFaces`; the remainder collapse into a `+k` overflow chip with a tooltip
 * listing the hidden names. Reads no context: callers select the occupants.
 */
export function PresenceAvatarStack({
  occupants,
  ariaLabel,
  maxFaces = 5,
}: {
  occupants: RosterOccupant[];
  ariaLabel: string;
  maxFaces?: number;
}) {
  if (occupants.length === 0) return null;

  const shown = occupants.slice(0, maxFaces);
  const hidden = occupants.slice(maxFaces);
  const overflow = hidden.length;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center -space-x-2" aria-label={ariaLabel}>
        {shown.map((o) => (
          <Tooltip key={o.userId}>
            <TooltipTrigger asChild>
              <span>
                <AvatarChip occupant={o} />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {o.isSelf ? `${o.name} (you)` : o.name}
            </TooltipContent>
          </Tooltip>
        ))}

        {overflow > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="bg-surface-muted text-muted-foreground ring-background relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums ring-2"
                aria-label={`${overflow} more ${overflow === 1 ? "person" : "people"}`}
              >
                {`+${overflow}`}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {hidden
                .map((o) => (o.isSelf ? `${o.name} (you)` : o.name))
                .join(", ")}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function AvatarChip({ occupant }: { occupant: RosterOccupant }) {
  return (
    <span
      className={cn(
        "bg-surface text-foreground ring-background relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-medium ring-2 select-none",
      )}
      // Per-user presence color as a thin inner border (data-driven, like status).
      style={{ boxShadow: `inset 0 0 0 1.5px ${occupant.color}` }}
    >
      {occupant.avatarUrl ? (
        <Image
          src={occupant.avatarUrl}
          alt=""
          width={28}
          height={28}
          unoptimized
          className="size-full object-cover"
        />
      ) : (
        initials(occupant.name)
      )}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
