import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Instant loading fallback for settings. Mirrors the page's centered
 * `mx-auto max-w-3xl px-6 py-10` column and three stacked Cards (Preferences,
 * Organization, Members). Static Server Component — no data fetch.
 */
export default function SettingsLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading settings"
      className="mx-auto max-w-3xl px-6 py-10"
    >
      <div className="mb-8 flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} data-testid="settings-card-skeleton">
            <CardHeader>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-56" />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
