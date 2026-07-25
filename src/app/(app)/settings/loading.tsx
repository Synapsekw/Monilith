import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant fallback for a settings section.
 *
 * The layout (header + nav) renders immediately and is NOT part of this
 * fallback — only the content column suspends, so switching sections never
 * blanks the navigation out from under the pointer. Mirrors the SettingRow
 * geometry (label left, 280px control right) so the swap to real content
 * doesn't shift the page. Static Server Component — no data fetch.
 */
export default function SettingsLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading settings">
      <div className="border-border border-b pb-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          data-testid="settings-row-skeleton"
          className="border-border flex flex-col gap-3 border-b py-5 last:border-b-0 md:flex-row md:items-start md:justify-between md:gap-8"
        >
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-9 md:w-[280px] md:shrink-0" />
        </div>
      ))}
    </div>
  );
}
