import { EmptyState } from "@/components/ui/empty-state";
import { LoadHeat } from "@/components/folders/charts/LoadHeat";
import type { LoadGrid } from "@/lib/folders/tower";
import { Failed, Panel } from "./Panel";

export function LoadPanel({
  kicker,
  title = "Load by board and week",
  grid,
  failed,
  onRetry,
}: {
  kicker: string;
  title?: string;
  grid: LoadGrid | null;
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <Panel kicker={kicker} title={title}>
      {failed || grid === null ? (
        <Failed onRetry={onRetry} />
      ) : grid.max === 0 ? (
        <EmptyState variant="inline">Nothing open in this window.</EmptyState>
      ) : (
        <>
          <LoadHeat grid={grid} />
          <p className="text-muted-foreground text-xs">
            Red: still open from a past week. Accent: due this week or later.
          </p>
        </>
      )}
    </Panel>
  );
}
