import { EmptyState } from "@/components/ui/empty-state";
import type { Milestone } from "@/lib/folders/rollup";
import { Panel } from "./Panel";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function MilestonesPanel({
  kicker,
  title = "Next milestones",
  milestones,
}: {
  kicker: string;
  title?: string;
  milestones: Milestone[];
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
                {fmtDate(m.endDate)} · {m.openBefore} open
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
