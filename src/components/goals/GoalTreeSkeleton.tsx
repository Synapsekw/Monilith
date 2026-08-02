import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for the goals page. Mirrors the page header (`border-b px-6
 * py-3`, title + new-goal button) and GoalTree's full-height sticky table
 * (4 columns: Goal / Progress / Status / Owner). Static — 0 data fetch.
 */
export function GoalTreeSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading goals"
      className="flex h-full flex-col"
    >
      <div
        data-testid="skeleton-header"
        className="flex items-center justify-between px-6 py-3"
      >
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-64" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-card sticky top-0 z-10 text-left text-xs">
            <tr className="border-b">
              {["w-40", "w-24", "w-20", "w-24"].map((w, i) => (
                <th key={i} className="px-3 py-2 font-medium">
                  <Skeleton className={`h-3 ${w}`} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} data-testid="goal-row-skeleton" className="border-t">
                <td className="px-3 py-2">
                  <div style={{ paddingLeft: (i % 3) * 20 }}>
                    <Skeleton className="h-4 w-48" />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="h-2 w-24 rounded-full" />
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="h-5 w-16 rounded-full" />
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="h-3 w-20" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
