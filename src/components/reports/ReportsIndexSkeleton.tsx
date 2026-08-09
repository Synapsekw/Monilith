import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for the `/reports` index. Mirrors ReportsIndex's centered
 * column (`mx-auto max-w-3xl gap-6 p-6`): kicker + heading + count line, a
 * bordered list of two-line report rows with a leading `size-4` icon and a
 * trailing scope chip, then the separated Templates section. Static Server
 * Component — no hooks, no data fetch.
 */
export function ReportsIndexSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading reports"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6"
    >
      <div data-testid="skeleton-header" className="flex flex-col gap-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3 w-48" />
      </div>

      <ul className="bg-surface divide-border divide-y overflow-hidden rounded-lg border">
        {Array.from({ length: 5 }).map((_, i) => (
          <li
            key={i}
            data-testid="report-row-skeleton"
            className="flex items-center gap-3 px-3 py-2.5"
          >
            <Skeleton className="size-4 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-4 w-16 shrink-0" />
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-3 border-t pt-6">
        <div
          data-testid="skeleton-templates-header"
          className="flex flex-col gap-1"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-56" />
        </div>
        <ul className="bg-surface divide-border divide-y overflow-hidden rounded-lg border">
          {Array.from({ length: 2 }).map((_, i) => (
            <li
              key={i}
              data-testid="template-row-skeleton"
              className="flex items-center gap-3 px-3 py-2.5"
            >
              <Skeleton className="size-4 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-32" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
