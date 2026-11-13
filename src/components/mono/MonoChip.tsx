import { Kicker } from "@/components/ui/kicker";
import { cn } from "@/lib/utils";
import { monoAccessibleLabel, ownerPossessive } from "@/lib/monos/labels";
import { MonoAvatar } from "./MonoAvatar";
import { DEFAULT_MONO_COLOR, isMonoColor } from "./mono-palette";

/** The "Agent" marker every Mono carries (spec §8). */
export function AgentChip({ className }: { className?: string }) {
  return (
    <Kicker
      size="xs"
      className={cn("border-border shrink-0 rounded border px-1", className)}
    >
      Agent
    </Kicker>
  );
}

/**
 * A Mono wherever it is named: face, name tinted by its colour (mixed toward
 * the foreground so pale colours stay readable in light mode), the Agent chip
 * and whose Mono it is.
 */
export function MonoIdentity({
  name,
  color,
  ownerName,
  size = 20,
  showOwner = true,
  className,
}: {
  name: string;
  color: string;
  ownerName: string | null;
  size?: number;
  showOwner?: boolean;
  className?: string;
}) {
  const safe = isMonoColor(color) ? color : DEFAULT_MONO_COLOR;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <MonoAvatar
        color={safe}
        size={size}
        label={monoAccessibleLabel(name, ownerName)}
      />
      <span
        className="truncate font-semibold"
        style={{ color: `color-mix(in oklab, ${safe} 65%, var(--foreground))` }}
      >
        {name}
      </span>
      <AgentChip />
      {showOwner ? (
        <span className="text-muted-foreground truncate text-xs">
          {ownerPossessive(ownerName)}
        </span>
      ) : null}
    </span>
  );
}
