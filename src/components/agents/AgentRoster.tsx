"use client";

import { Switch } from "@/components/ui/switch";
import { Kicker } from "@/components/ui/kicker";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";

export type RosterAgent = {
  id: string;
  name: string;
  templateId: string;
  cadence: "daily";
  runAtLocalHour: number;
  enabled: boolean;
  lastRunStatus: "ran" | "skipped" | "error" | null;
};

const STATUS_COLOR = {
  ran: "green",
  skipped: "gray",
  error: "red",
} as const;

const STATUS_LABEL = {
  ran: "Ran",
  skipped: "Skipped",
  error: "Failed",
} as const;

function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/** The person's agent list. Toggling is the only mutation here; editing opens
 *  the editor. Hairlines brighten on hover — never thicken (Keystone). */
export function AgentRoster({
  agents,
  onToggle,
  onEdit,
}: {
  agents: RosterAgent[];
  onToggle: (id: string, enabled: boolean) => void;
  onEdit?: (id: string) => void;
}) {
  if (agents.length === 0) {
    // NOTE: EmptyState takes `children` — it has no title/description props.
    return (
      <EmptyState>
        No agents yet. Start from a template below — you can edit everything
        afterwards.
      </EmptyState>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {agents.map((a) => (
        <li
          key={a.id}
          className="bg-surface hover:border-border-hover ease-keystone flex items-center justify-between rounded-lg border p-4 transition-colors"
        >
          <button
            type="button"
            onClick={onEdit ? () => onEdit(a.id) : undefined}
            disabled={!onEdit}
            className="focus-visible:ring-ring min-w-0 flex-1 rounded-md text-left focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default"
          >
            <Kicker>{a.templateId.replace(/-/g, " ")}</Kicker>
            <p className="truncate text-sm font-semibold">{a.name}</p>
            <p className="text-muted-foreground text-xs">
              Daily at {hourLabel(a.runAtLocalHour)}
            </p>
          </button>
          <div className="flex shrink-0 items-center gap-3">
            {a.lastRunStatus ? (
              <StatusPill color={STATUS_COLOR[a.lastRunStatus]} variant="soft">
                {STATUS_LABEL[a.lastRunStatus]}
              </StatusPill>
            ) : null}
            <Switch
              checked={a.enabled}
              aria-label={`Enable ${a.name}`}
              onCheckedChange={(v) => onToggle(a.id, v)}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
