import Link from "next/link";
import { StackedStatusBar } from "@/components/folders/charts/StackedStatusBar";
import type { BoardSummary } from "@/lib/folders/rollup";
import { Failed, Panel } from "./Panel";

export function BoardStatusPanel({
  kicker,
  title = "Status by board",
  boards,
  failed,
  onRetry,
}: {
  kicker: string;
  title?: string;
  boards: BoardSummary[];
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <Panel kicker={kicker} title={title}>
      {failed ? (
        <Failed onRetry={onRetry} />
      ) : (
        boards.map((b) => (
          <div key={b.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <Link
                href={`/boards/${b.id}`}
                className="hover:text-foreground text-muted-foreground font-medium"
              >
                {b.name}
              </Link>
              <span className="text-muted-foreground font-mono tabular-nums">
                {b.total}
              </span>
            </div>
            <StackedStatusBar
              mix={{
                done: b.done,
                inProgress: b.inProgress,
                overdue: b.overdue,
                notStarted: b.notStarted,
              }}
              label={b.name}
            />
          </div>
        ))
      )}
    </Panel>
  );
}
