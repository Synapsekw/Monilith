import { EmptyState } from "@/components/ui/empty-state";
import type { Milestone } from "@/lib/folders/rollup";
import { fmtDay } from "@/lib/folders/tower";
import { Panel } from "./Panel";

/** Dates are formatted in UTC, like every week on this page, with the year
 *  when it is not the current one. */
export function MilestonesPanel({
  kicker,
  title = "Next milestones",
  milestones,
  todayISO,
}: {
  kicker: string;
  title?: string;
  milestones: Milestone[];
  /** The page's today; a date outside its year shows the year. */
  todayISO?: string;
}) {
  return (
    <Panel kicker={kicker} title={title}>
      {milestones.length === 0 ? (
        <EmptyState variant="inline">No upcoming stage end dates.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {milestones.map((m) => (
            <li
              key={m.stageKey}
              data-testid="milestone"
              className="flex items-center justify-between text-xs"
            >
              <span className="font-medium">{m.name}</span>
              <span className="text-muted-foreground font-mono">
                {fmtDay(m.endDate, todayISO)} · {m.open} open
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
