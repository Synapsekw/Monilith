import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Instant loading fallback for a fresh `/ask` chat. Static Server Component —
 * `NewAskPage` awaits `listOwnerAgentTargets` before it can render the real
 * composer, so this is what shows for that one bounded read.
 *
 * Mirrors `AskChat`'s column: a handful of message-shaped rows (alternating
 * gutter side, like user/assistant bubbles) above the composer bar, so the
 * swap-in doesn't jump the page around.
 */
export default function AskLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading conversation"
      className="flex h-full flex-col"
    >
      <div className="flex flex-1 flex-col gap-4 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            data-testid="ask-message-skeleton"
            className={cn(
              "flex",
              i % 2 === 0 ? "justify-end" : "justify-start",
            )}
          >
            <Skeleton className="h-12 w-2/3 max-w-md rounded-lg" />
          </div>
        ))}
      </div>
      <div
        data-testid="ask-composer-skeleton"
        className="bg-background border-t px-4 py-3"
      >
        <Skeleton className="mx-auto h-11 max-w-3xl rounded-lg" />
      </div>
    </div>
  );
}
