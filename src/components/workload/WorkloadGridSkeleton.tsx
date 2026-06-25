import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for the workload grid. Mirrors WorkloadGrid: filter toolbar
 * (`border-b px-4 py-3` with pill groups) and a frozen-left grid — `w-56`
 * member column, ~12 week columns (`min-w-24`). Static — 0 data fetch.
 */
export function WorkloadGridSkeleton() {
  const weeks = Array.from({ length: 12 });
  const rows = Array.from({ length: 6 });
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading workload"
      className="flex h-full flex-col"
    >
      <div
        data-testid="skeleton-toolbar"
        className="flex items-center justify-between gap-3 border-b px-4 py-3"
      >
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-44" />
        </div>
        <div className="flex items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20" />
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="bg-card sticky top-0 z-20 text-xs">
            <tr>
              <th
                data-testid="frozen-member-col"
                className="bg-card sticky left-0 z-30 w-56 min-w-56 border-r border-b px-4 py-2 text-left"
              >
                <Skeleton className="h-3 w-20" />
              </th>
              {weeks.map((_, i) => (
                <th
                  key={i}
                  data-testid="week-col-skeleton"
                  className="min-w-24 border-b px-2 py-2 text-center"
                >
                  <Skeleton className="mx-auto h-3 w-12" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((_, r) => (
              <tr key={r}>
                <td className="bg-background sticky left-0 z-10 w-56 min-w-56 border-r border-b px-4 py-2">
                  <Skeleton className="h-4 w-36" />
                </td>
                {weeks.map((_, c) => (
                  <td key={c} className="border-b px-1.5 py-1.5 align-middle">
                    <Skeleton className="h-6 w-full" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
