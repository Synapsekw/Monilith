"use client";

import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * A dependency whose other end is not on this canvas (another board, or out of
 * view), drawn as a stub on the local bar instead of an arrow.
 *
 * Mirrors `ExternalLinkStub` in `src/lib/boards/cross-board.ts` (Task 2). Kept
 * local until that module lands on this branch; switch to a type import then.
 */
export type ExternalLinkStub = {
  dependencyId: string;
  direction: "waiting_on" | "blocking";
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  endISO: string | null;
  late: boolean;
};

/** Stubs shown inline before the rest collapse into "+N". */
const MAX_INLINE = 2;
/** Widest a single chip can grow (its `max-w-36`). */
const CHIP_MAX_W = 144;
/** Width of the "+N" overflow chip. */
const OVERFLOW_W = 32;
/** `gap-1` between chips. */
const CHIP_GAP = 4;

/**
 * Upper bound on the rendered width of a chip row holding `count` stubs —
 * conservative (every chip at its max width) so a "fits" verdict never clips.
 */
export function estimateStubRowW(count: number): number {
  if (count <= 0) return 0;
  const chips = Math.min(count, MAX_INLINE);
  const overflow = count > MAX_INLINE ? 1 : 0;
  return (
    chips * CHIP_MAX_W +
    overflow * OVERFLOW_W +
    (chips + overflow - 1) * CHIP_GAP
  );
}

/**
 * Where a group of stubs renders relative to its bar: `before` (left of the
 * bar), `after` (right of it), or `inside` (overlaid at the bar's end, clamped
 * within the track) when neither side has room.
 */
export type StubSide = "before" | "after" | "inside";

/**
 * Choose a side per stub group so no chip row falls off the clipped track.
 * Each group prefers its natural side — "waiting on" before the bar,
 * "blocking" after it — flips to the other side when its own side lacks room
 * (the earliest bar always sits at x=0; the latest ends at the track edge),
 * and falls back to `inside` when neither side fits.
 */
export function placeLinkStubs(args: {
  barStartX: number;
  barEndX: number;
  trackW: number;
  gap: number;
  waitingOnCount: number;
  blockingCount: number;
}): { waitingOn: StubSide; blocking: StubSide } {
  const roomBefore = args.barStartX - args.gap;
  const roomAfter = args.trackW - args.barEndX - args.gap;
  const pick = (count: number, prefer: "before" | "after"): StubSide => {
    const need = estimateStubRowW(count);
    const fitsBefore = roomBefore >= need;
    const fitsAfter = roomAfter >= need;
    if (prefer === "before") {
      return fitsBefore ? "before" : fitsAfter ? "after" : "inside";
    }
    return fitsAfter ? "after" : fitsBefore ? "before" : "inside";
  };
  return {
    waitingOn: pick(args.waitingOnCount, "before"),
    blocking: pick(args.blockingCount, "after"),
  };
}

function stubLabel(stub: ExternalLinkStub): string {
  const verb = stub.direction === "waiting_on" ? "Waiting on" : "Blocking";
  return `${verb} ${stub.itemName} · ${stub.boardName}`;
}

function StubChip({
  stub,
  onTap,
  className,
}: {
  stub: ExternalLinkStub;
  onTap: (s: ExternalLinkStub) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={stubLabel(stub)}
      title={stubLabel(stub)}
      onClick={(e) => {
        e.stopPropagation();
        onTap(stub);
      }}
      className={cn(
        "bg-surface text-muted-foreground hover:text-foreground hover:border-border-hover focus-visible:ring-ring text-2xs flex h-5 max-w-36 shrink-0 items-center gap-1 rounded-sm border px-1.5 font-mono transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:h-8",
        stub.late && "border-destructive/40",
        className,
      )}
    >
      <span aria-hidden>{stub.direction === "waiting_on" ? "↤" : "↦"}</span>
      <span className="min-w-0 truncate">{stub.itemName}</span>
      {stub.late && (
        <Kicker size="xs" className="text-destructive shrink-0">
          Late
        </Kicker>
      )}
    </button>
  );
}

/**
 * Compact chip row of cross-board / out-of-view links for one bar. The canvas
 * positions the row (right of the bar for `blocking`, left for `waiting_on`).
 * More than {@link MAX_INLINE} stubs collapse the rest into a "+N" popover that
 * lists every stub.
 */
export function LinkStubs({
  stubs,
  onTap,
}: {
  stubs: ExternalLinkStub[];
  onTap: (s: ExternalLinkStub) => void;
}) {
  if (stubs.length === 0) return null;
  const overflow = stubs.length > MAX_INLINE;
  const inline = overflow ? stubs.slice(0, MAX_INLINE) : stubs;

  return (
    <div className="flex items-center gap-1">
      {inline.map((stub) => (
        <StubChip key={stub.dependencyId} stub={stub} onTap={onTap} />
      ))}
      {overflow && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Show all ${stubs.length} linked items`}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface text-muted-foreground hover:text-foreground hover:border-border-hover focus-visible:ring-ring text-2xs flex h-5 shrink-0 items-center rounded-sm border px-1.5 font-mono tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:h-8"
            >
              +{stubs.length - MAX_INLINE}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <div className="px-1 pb-1.5">
              <Kicker>Linked items</Kicker>
            </div>
            <div className="flex flex-col gap-1">
              {stubs.map((stub) => (
                <StubChip
                  key={stub.dependencyId}
                  stub={stub}
                  onTap={onTap}
                  className="h-7 max-w-none justify-start"
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
