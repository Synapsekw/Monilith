import { EmptyState } from "@/components/ui/empty-state";
import { STATUS_BG } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import type { StageBar } from "@/lib/folders/tower";

/** Items per stage with the stale share marked: what the burn section shows
 *  for a folder that has no dates to plot (a pipeline, a backlog). */
export function StageBars({ bars }: { bars: StageBar[] }) {
  if (bars.length === 0)
    return <EmptyState variant="inline">No items yet.</EmptyState>;
  const max = Math.max(1, ...bars.map((b) => b.total));
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {bars.map((b) => (
          <li
            key={b.key}
            className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-3 text-xs"
          >
            <span className="truncate font-medium" title={b.name}>
              {b.name}
            </span>
            <div
              role="img"
              aria-label={`${b.name}: ${b.total} items, ${b.stale} stale`}
              className="bg-surface-muted flex h-3 overflow-hidden rounded-sm"
            >
              <div
                className={cn("h-full", STATUS_BG.blue)}
                style={{ width: `${((b.total - b.stale) / max) * 100}%` }}
              />
              <div
                data-testid="stage-bar-stale"
                className={cn("h-full", STATUS_BG.yellow)}
                style={{ width: `${(b.stale / max) * 100}%` }}
              />
            </div>
            <span className="text-muted-foreground font-mono tabular-nums">
              {b.stale > 0 ? `${b.total} · ${b.stale} stale` : b.total}
            </span>
          </li>
        ))}
      </ul>
      <div className="text-muted-foreground flex gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-sm", STATUS_BG.blue)} /> Active
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-sm", STATUS_BG.yellow)} /> Stale
          (untouched &gt; 14 days)
        </span>
      </div>
    </div>
  );
}
