import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for a portfolio. Mirrors the page title bar (`border-b px-4
 * py-3`) and PortfolioGrid's 9-column sticky table. Static — 0 data fetch.
 */
export function PortfolioGridSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading portfolio"
      className="flex h-full flex-col"
    >
      <div className="border-b px-4 py-3">
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-card text-muted-foreground sticky top-0 z-10 text-xs">
            <tr className="border-b">
              {Array.from({ length: 9 }).map((_, i) => (
                <th
                  key={i}
                  data-testid="portfolio-col-skeleton"
                  className="px-3 py-2 text-left"
                >
                  <Skeleton className="h-3 w-16" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }).map((_, r) => (
              <tr
                key={r}
                data-testid="portfolio-row-skeleton"
                className="border-t"
              >
                {Array.from({ length: 9 }).map((_, c) => (
                  <td key={c} className="px-3 py-2">
                    <Skeleton className="h-4 w-full" />
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
