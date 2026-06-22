"use client";

import { useBoardPresenceContext } from "@/lib/boards/presence-context";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RosterOccupant } from "@/lib/boards/presence-types";

/**
 * Overlapping avatar stack of everyone currently present on the board. Faces
 * are capped at `maxFaces`; the remainder collapse into a `+k` overflow chip.
 * Presentational only — reads the roster from presence context.
 */
export function BoardPresenceBar({ maxFaces = 5 }: { maxFaces?: number }) {
  const { roster } = useBoardPresenceContext();
  if (roster.length === 0) return null;

  const shown = roster.slice(0, maxFaces);
  const overflow = roster.length - shown.length;
  const hidden = roster.slice(maxFaces);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center -space-x-2" aria-label="People on this board">
        {shown.map((o) => (
          <Tooltip key={o.userId}>
            <TooltipTrigger asChild>
              <span>
                <AvatarChip occupant={o} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{o.isSelf ? `${o.name} (you)` : o.name}</TooltipContent>
          </Tooltip>
        ))}

        {overflow > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="bg-surface-muted text-muted-foreground ring-background relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ring-2 tabular-nums"
                aria-label={`${overflow} more ${overflow === 1 ? "person" : "people"}`}
              >
                {`+${overflow}`}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {hidden.map((o) => (o.isSelf ? `${o.name} (you)` : o.name)).join(", ")}
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
        // eslint-disable-next-line @next/next/no-img-element -- user avatars from arbitrary hosts; matches existing convention (FilesCell, AttachmentCard)
        <img src={occupant.avatarUrl} alt="" className="size-full object-cover" />
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
