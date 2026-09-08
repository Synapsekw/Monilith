import { Skeleton } from "@/components/ui/skeleton";
import { ROW_HEIGHT } from "@/components/boards/table/shared";

/**
 * Instant loading fallback for a board. Rendered immediately on navigation
 * while the board page streams in; the layout (sidebar + header) stays mounted,
 * so only this content area shows the skeleton.
 *
 * Mirrors the real table's shape — a toolbar strip (view switcher, filters,
 * sort, group) above dense `ROW_HEIGHT` (36px) rows — so the swap-in doesn't
 * jump the page around once the real data lands.
 */
export default function BoardLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading board"
      className="flex h-full flex-col"
    >
      <div className="flex h-14 items-center justify-between px-4">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div
        data-testid="board-toolbar-skeleton"
        className="border-border flex h-11 items-center gap-2 border-b px-4"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20" />
        ))}
      </div>
      <div className="flex flex-col">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            data-testid="board-row-skeleton"
            className="border-border flex items-center gap-3 border-b px-4"
            style={{ height: ROW_HEIGHT }}
          >
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-5 w-20 rounded-sm" />
            <Skeleton className="size-6 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
