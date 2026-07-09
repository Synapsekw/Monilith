import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for the `/boards` index. Mirrors BoardsIndex's centered column
 * (`mx-auto max-w-3xl gap-6 p-6`): page heading + hint, a bordered board-link
 * list (rows are `px-3 py-2` with a `text-sm` line → `h-4` bars), and the
 * collapsed "Archived boards" section header (two `size-4` icons + label +
 * trailing count). Static — 0 data fetch.
 */
export function BoardsIndexSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading boards"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6"
    >
      <div data-testid="skeleton-header" className="flex flex-col gap-1">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="mt-1 h-3 w-72" />
      </div>

      <section className="bg-surface rounded-md border">
        <ul>
          {Array.from({ length: 5 }).map((_, i) => (
            <li
              key={i}
              data-testid="board-row-skeleton"
              className={i > 0 ? "border-t" : undefined}
            >
              <div className="flex items-center px-3 py-2">
                <Skeleton className="h-4 w-44" />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section
        data-testid="archived-section-skeleton"
        className="bg-surface rounded-md border"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <Skeleton className="size-4 shrink-0" />
          <Skeleton className="size-4 shrink-0" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="ml-auto h-3 w-6" />
        </div>
      </section>
    </div>
  );
}
