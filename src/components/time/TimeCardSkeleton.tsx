import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for the weekly time card. Mirrors TimeCard: toolbar
 * (`border-b px-4 py-3`, title + week nav) and a frozen-left week grid —
 * `w-64` label column, 7 day columns (`min-w-20`), totals column, footer
 * total row. Static — 0 data fetch.
 */
export function TimeCardSkeleton() {
  const days = Array.from({ length: 7 });
  const rows = Array.from({ length: 6 });
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading time card"
      className="flex h-full flex-col"
    >
      <div
        data-testid="skeleton-toolbar"
        className="flex items-center justify-between gap-3 px-4 py-3"
      >
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="size-8" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="size-8" />
        </div>
      </div>
      <div data-scroll-container className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="bg-card sticky top-0 z-20 text-xs">
            <tr>
              <th
                data-testid="frozen-label-col"
                className="bg-card sticky left-0 z-30 w-64 min-w-64 border-r border-b px-4 py-2 text-left"
              >
                <Skeleton className="h-3 w-24" />
              </th>
              {days.map((_, i) => (
                <th
                  key={i}
                  data-testid="day-col-skeleton"
                  className="min-w-20 border-b px-2 py-2"
                >
                  <Skeleton className="mx-auto h-3 w-10" />
                </th>
              ))}
              <th className="min-w-20 border-b border-l px-2 py-2">
                <Skeleton className="mx-auto h-3 w-10" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((_, r) => (
              <tr key={r}>
                <td className="bg-background sticky left-0 z-10 w-64 min-w-64 border-r border-b px-4 py-1.5">
                  <Skeleton className="h-4 w-40" />
                </td>
                {days.map((_, c) => (
                  <td key={c} className="border-b px-1.5 py-1.5 text-center">
                    <Skeleton className="mx-auto h-6 w-12" />
                  </td>
                ))}
                <td className="border-b border-l px-2 py-1.5 text-center">
                  <Skeleton className="mx-auto h-4 w-8" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="bg-card sticky left-0 z-10 border-t border-r px-4 py-2">
                <Skeleton className="h-3 w-20" />
              </td>
              {days.map((_, c) => (
                <td key={c} className="border-t px-2 py-2 text-center">
                  <Skeleton className="mx-auto h-3 w-8" />
                </td>
              ))}
              <td className="border-t border-l px-2 py-2 text-center">
                <Skeleton className="mx-auto h-3 w-8" />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
