import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant loading fallback for `/updates`. The page itself is static (the
 * changelog is a bundled constant, not a fetch), so in practice this only
 * shows during the route's own code-split chunk load — but it still needs to
 * mirror `ChangelogTimeline`'s shape rather than leave a blank frame.
 *
 * Four entries in `ChangelogTimeline`'s bordered, indented layout.
 */
export default function UpdatesLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading updates"
      className="mx-auto max-w-2xl px-6 py-20"
    >
      <div className="mb-12 flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="space-y-10 border-l pl-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            data-testid="update-entry-skeleton"
            className="flex flex-col gap-2"
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
