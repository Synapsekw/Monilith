"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Kicker } from "@/components/ui/kicker";
import { cn } from "@/lib/utils";
import { showMutationError } from "@/lib/ui/mutation-toast";
import {
  getBoardAutopilot,
  saveBoardAutopilot,
  type BoardAutopilotState,
} from "@/lib/boards/autopilot-actions";
import {
  AUTOPILOT_CADENCES,
  type AutopilotCadence,
  type AutopilotTask,
  type BoardAgentSettings,
} from "@/lib/ai/agentic/autopilot-config";

/** The three housekeeping tasks a board agent can run (spec §4.3). Each maps to
 *  exactly one reversible action the confined applier is allowed to take. */
const TASK_META: { id: AutopilotTask; label: string; desc: string }[] = [
  {
    id: "triage",
    label: "Triage new items",
    desc: "Move ungrouped items into the group that fits them best.",
  },
  {
    id: "chase_overdue",
    label: "Chase overdue owners",
    desc: "Leave an @mention comment nudging the owner of an overdue item.",
  },
  {
    id: "goal_rollup",
    label: "Keep goal rollups current",
    desc: "Nudge a percent column toward the value the board implies.",
  },
];

function autopilotKey(boardId: string) {
  return ["board-autopilot", boardId] as const;
}

/**
 * Board-settings card for the F14 Autopilot agent: an enable/disable **kill
 * switch**, the housekeeping tasks to run, and the cadence + local hour it runs
 * on. Admin-only writes (RLS is the real boundary; the UI disables controls for
 * non-admins). Toggling the kill switch persists immediately; the rest saves on
 * "Save changes". Follows Pulse "Monolith Keystone" — monochrome chrome, one
 * periwinkle accent on the primary action + the enabled switch.
 */
export function AutopilotCard({ boardId }: { boardId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<BoardAutopilotState>({
    queryKey: autopilotKey(boardId),
    staleTime: 30_000,
    queryFn: () => getBoardAutopilot(boardId),
  });

  const isAdmin = data?.isAdmin ?? false;
  const serverSettings = data?.settings;
  const [form, setForm] = useState<BoardAgentSettings | null>(
    serverSettings ?? null,
  );
  // Re-seed the editable form when a genuinely new server snapshot arrives
  // (react-query keeps the same object identity between refetches). This is the
  // React-blessed "adjust state during render" pattern — no effect, no cascade.
  const [seen, setSeen] = useState<BoardAgentSettings | undefined>(
    serverSettings,
  );
  if (serverSettings && serverSettings !== seen) {
    setSeen(serverSettings);
    setForm(serverSettings);
  }

  const save = useMutation({
    mutationFn: async (settings: BoardAgentSettings) => {
      const res = await saveBoardAutopilot({ boardId, settings });
      if (!res.ok) throw new Error(res.error);
      return settings;
    },
    onSuccess: (settings) => {
      qc.setQueryData<BoardAutopilotState>(autopilotKey(boardId), (prev) =>
        prev ? { ...prev, settings, configured: true } : prev,
      );
    },
    onError: (err: Error) =>
      showMutationError("Couldn't save Autopilot settings.", err),
  });

  if (isLoading || !form) {
    return (
      <div className="bg-surface flex items-center gap-2 rounded-lg border p-4">
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
        <span className="text-muted-foreground text-sm">
          Loading Autopilot…
        </span>
      </div>
    );
  }

  const disabled = !isAdmin || save.isPending;
  const dirty =
    !!data && JSON.stringify(form) !== JSON.stringify(data.settings);

  const patch = (next: Partial<BoardAgentSettings>) =>
    setForm((f) => (f ? { ...f, ...next } : f));

  const toggleTask = (id: AutopilotTask) =>
    patch({
      tasks: form.tasks.includes(id)
        ? form.tasks.filter((t) => t !== id)
        : [...form.tasks, id],
    });

  // The kill switch persists immediately (one click stops/starts the agent).
  const toggleEnabled = (next: boolean) => {
    const settings = { ...form, enabled: next };
    setForm(settings);
    save.mutate(settings);
  };

  return (
    <div className="bg-surface hover:border-border-hover flex flex-col gap-4 rounded-lg border p-4 transition-colors">
      {/* Header + kill switch */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Kicker>Autopilot</Kicker>
          <div className="flex items-center gap-2">
            <Bot className="size-4" aria-hidden />
            <h3 className="text-sm font-bold">Scheduled board agent</h3>
          </div>
          <p className="text-muted-foreground text-xs">
            Runs bounded, reversible housekeeping on a schedule, posting as{" "}
            <span className="text-foreground font-medium">Pulse Autopilot</span>
            . Every action is logged and confined to this board.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Switch
            checked={form.enabled}
            onCheckedChange={toggleEnabled}
            disabled={disabled}
            aria-label={form.enabled ? "Disable Autopilot" : "Enable Autopilot"}
          />
          <span
            className={cn(
              "text-[11px] font-medium",
              form.enabled ? "text-primary" : "text-muted-foreground",
            )}
          >
            {form.enabled ? "On" : "Off"}
          </span>
        </div>
      </div>

      {/* Housekeeping tasks */}
      <fieldset
        disabled={disabled}
        className="flex flex-col gap-2 disabled:opacity-60"
      >
        <legend className="text-muted-foreground mb-1 text-xs font-medium">
          Housekeeping tasks
        </legend>
        {TASK_META.map((t) => {
          const on = form.tasks.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggleTask(t.id)}
              disabled={disabled}
              className={cn(
                "bg-surface-muted hover:border-border-hover flex items-start gap-3 rounded-md border p-2.5 text-left transition-colors",
                on && "border-border-bright",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px]",
                  on
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "border-border-bright",
                )}
                aria-hidden
              >
                {on ? "✓" : ""}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t.label}</span>
                <span className="text-muted-foreground text-xs">{t.desc}</span>
              </span>
            </button>
          );
        })}
      </fieldset>

      {/* Cadence + local hour */}
      <fieldset
        disabled={disabled}
        className="flex flex-wrap items-end gap-4 disabled:opacity-60"
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs font-medium">
            Cadence
          </span>
          <div className="flex gap-1">
            {AUTOPILOT_CADENCES.map((c) => (
              <Button
                key={c}
                type="button"
                size="sm"
                variant={form.cadence === c ? "default" : "outline"}
                onClick={() => patch({ cadence: c as AutopilotCadence })}
                disabled={disabled}
                className="capitalize"
              >
                {c}
              </Button>
            ))}
          </div>
        </div>
        {form.cadence === "daily" ? (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`autopilot-hour-${boardId}`}
              className="text-muted-foreground text-xs font-medium"
            >
              Run at (board-local hour)
            </label>
            <Input
              id={`autopilot-hour-${boardId}`}
              type="number"
              min={0}
              max={23}
              value={form.runAtLocalHour}
              disabled={disabled}
              onChange={(e) =>
                patch({
                  runAtLocalHour: Math.max(
                    0,
                    Math.min(23, Number(e.target.value) || 0),
                  ),
                })
              }
              className="w-20"
            />
          </div>
        ) : null}
      </fieldset>

      {!isAdmin ? (
        <p className="text-muted-foreground text-xs">
          Only an organization admin can configure Autopilot.
        </p>
      ) : (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={disabled || !dirty}
            onClick={() => save.mutate(form)}
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </div>
  );
}
