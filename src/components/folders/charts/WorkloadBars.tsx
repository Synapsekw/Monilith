import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { STATUS_BG } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

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

export function WorkloadBars({
  people,
  threshold = OVERLOAD_THRESHOLD,
}: {
  people: WorkloadPerson[];
  threshold?: number;
}) {
  if (people.length === 0)
    return (
      <EmptyState variant="inline">
        No open items are assigned in this stage.
      </EmptyState>
    );
  const max = Math.max(threshold, ...people.map((p) => p.open));
  return (
    <ul className="flex flex-col gap-2">
      {people.map((p) => {
        const overloaded = p.open > threshold;
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
                className={cn(
                  "h-full rounded-sm",
                  overloaded ? STATUS_BG.red : STATUS_BG.blue,
                )}
                style={{ width: `${(p.open / max) * 100}%` }}
              />
              <div
                aria-hidden
                className="bg-border-bright absolute inset-y-0 w-px"
                style={{ left: `${(threshold / max) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right font-mono tabular-nums">
              {p.open}
            </span>
            {p.overdue > 0 ? (
              <span className="text-status-red text-2xs font-mono">
                {p.overdue} late
              </span>
            ) : (
              <span className="w-10" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
