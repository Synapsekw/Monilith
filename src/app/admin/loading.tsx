import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant loading fallback for the platform-admin overview.
 *
 * Mirrors AdminOverview's `space-y-8` column: header, the four-up StatCard
 * grid (`grid-cols-2 sm:grid-cols-4`, each card `rounded-xl border p-4`), then
 * the `lg:grid-cols-[1.3fr_1fr]` split of "Recent organizations" and "Recent
 * activity" panels. Static Server Component — no data fetch, so the whole
 * `/admin` tree stops blocking navigation on its Supabase reads.
 */
export default function AdminOverviewLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading platform admin"
      className="space-y-8"
    >
      <div data-testid="skeleton-header" className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            data-testid="stat-card-skeleton"
            className="bg-surface rounded-xl border p-4"
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-1.5 h-8 w-16" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        {[5, 8].map((rows, s) => (
          <section
            key={s}
            data-testid="admin-panel-skeleton"
            className="bg-surface rounded-xl border p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-16" />
            </div>
            <ul className="divide-border divide-y">
              {Array.from({ length: rows }).map((_, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <Skeleton className="h-4 w-full max-w-56" />
                  <Skeleton className="h-3 w-20 shrink-0" />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
