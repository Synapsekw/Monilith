import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { STATUS_BG } from "@/components/ui/status-pill";

export type WorkloadPerson = {
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  open: number;
  overdue: number;
};
/** Spec §5.5.1: constant in v1, configurable later. */
export const OVERLOAD_THRESHOLD = 15;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Open work per person. Bar length is open items scaled to the person with
 * the most; inside it the late share is a red segment and the rest is the
 * brand colour, so "how much" and "how much of it is late" read at once. Over
 * `threshold` open items a person is flagged in words ("over 15"), not by
 * painting the whole bar red. The "N late" figure repeats the red segment in
 * text, so colour is never the only signal.
 */
export function WorkloadBars({
  people,
  threshold = OVERLOAD_THRESHOLD,
  stage = null,
}: {
  people: WorkloadPerson[];
  threshold?: number;
  /** The active stage filter, for the empty state's wording only. */
  stage?: string | null;
}) {
  if (people.length === 0)
    return (
      <EmptyState variant="inline">
        {stage === null
          ? "No open items are assigned."
          : "No open items are assigned in this stage."}
      </EmptyState>
    );
  const max = Math.max(1, ...people.map((p) => p.open));
  // A column is reserved on every row only when some row fills it, so the
  // figures align without spending ~48px per empty column in narrow panels.
  const anyLate = people.some((p) => p.overdue > 0);
  const anyOver = people.some((p) => p.open > threshold);
  return (
    <ul className="flex flex-col gap-2">
      {people.map((p) => {
        const overloaded = p.open > threshold;
        const latePct =
          p.open === 0 ? 0 : (Math.min(p.overdue, p.open) / p.open) * 100;
        return (
          <li
            key={p.userId ?? "__unassigned"}
            className="flex items-center gap-3 text-xs"
          >
            <Avatar className="size-6">
              {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-2xs">
                {initials(p.name)}
              </AvatarFallback>
            </Avatar>
            <span className="w-32 truncate font-medium">{p.name}</span>
            <div className="bg-surface-muted relative h-2 min-w-0 flex-1 overflow-hidden rounded-sm">
              <div
                data-testid="workload-bar"
                data-overloaded={overloaded ? "true" : "false"}
                className="bg-primary flex h-full justify-end overflow-hidden rounded-sm"
                style={{ width: `${(p.open / max) * 100}%` }}
              >
                {latePct > 0 ? (
                  <div
                    data-testid="workload-late"
                    aria-hidden
                    className={`h-full ${STATUS_BG.red}`}
                    style={{ width: `${latePct}%` }}
                  />
                ) : null}
              </div>
            </div>
            <span className="w-8 text-right font-mono tabular-nums">
              {p.open}
            </span>
            {anyLate ? (
              <span
                data-col="late"
                className="text-status-red text-2xs min-w-12 font-mono whitespace-nowrap"
              >
                {p.overdue > 0 ? `${p.overdue} late` : null}
              </span>
            ) : null}
            {anyOver ? (
              <span
                data-col="over"
                className="text-muted-foreground text-2xs min-w-12 font-mono whitespace-nowrap"
              >
                {overloaded ? `over ${threshold}` : null}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
