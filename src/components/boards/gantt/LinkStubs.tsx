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
