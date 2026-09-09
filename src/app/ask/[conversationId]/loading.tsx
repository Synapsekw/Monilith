import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Instant loading fallback for an existing `/ask/[conversationId]` thread.
 * `AskConversationPage` awaits the thread's messages, run id, agent roster and
 * header before it can render `AskChat`, so this is what shows while those
 * bounded, indexed reads settle.
 *
 * Same shape as the new-chat skeleton (`../loading.tsx`) — a handful of
 * message-shaped rows above the composer bar — since both resolve into the
 * same `AskChat` column.
 */
export default function AskConversationLoading() {
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
