"use client";

import { useState, useTransition } from "react";
import {
  AGENT_CAPABILITIES,
  type AgentCapability,
} from "@/lib/agents/capabilities";
import { CAPABILITY_COPY } from "@/lib/agents/capability-copy";
import { setAgentCapabilityCeiling } from "@/lib/ai/settings-actions";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useFieldStatus } from "@/components/ui/field-status";
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";

/**
 * Admin Settings → AI: the org-wide CEILING on what any personal agent may be
 * granted, no matter what an individual owner ticks in their own editor
 * (`CapabilityToggles`, Task 8). The two controls render the same four
 * capabilities from the same copy table (`capability-copy.ts`) for opposite
 * purposes — this one WRITES `agent_capability_ceiling`, `CapabilityToggles`
 * only READS it to grey out what it can no longer offer — so they share the
 * label/consequence table and nothing else. There is deliberately no
 * "disabled because over ceiling" state here: this control IS the ceiling,
 * so every switch stays interactive regardless of its current value.
 *
 * Optimistic, like the mode radios in `OrgAiSettingsForm`: a toggle flips
 * immediately and reverts to the last server-acknowledged set if
 * `setAgentCapabilityCeiling` refuses it (a non-admin, or a race with another
 * admin). The whole row of switches is disabled while a save is in flight —
 * a second click before the first lands would otherwise send a `capabilities`
 * array that does not include the first click's own change.
 */
export function OrgAgentCeiling({ initial }: { initial: AgentCapability[] }) {
  const [ceiling, setCeiling] = useState<AgentCapability[]>(initial);
  const [confirmed, setConfirmed] = useState<AgentCapability[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The failure belongs to the whole row of switches (a rejected save reverts
  // one of them), so it describes the group. `aria-invalid` has no meaning on
  // a group, hence only the description is wired.
  const errorStatus = useFieldStatus(error);
  // Every switch disables itself while the save is in flight, so the one the
  // user just flipped leaves the tab order and focus falls to `<body>`. Track
  // which one it was and hand it back its focus when the save resolves.
  const [lastToggled, setLastToggled] = useState<AgentCapability | null>(null);
  const restoreRef = useRestoreFocusAfterPending<HTMLButtonElement>(pending);

  function toggle(capability: AgentCapability, checked: boolean) {
    if (pending) return;
    const next = checked
      ? [...ceiling, capability]
      : ceiling.filter((c) => c !== capability);
    setError(null);
    setLastToggled(capability);
    setCeiling(next); // optimistic
    startTransition(async () => {
      const res = await setAgentCapabilityCeiling({ capabilities: next });
      if (res.ok) {
        setConfirmed(next);
      } else {
        setCeiling(confirmed); // revert
        setError(res.error);
      }
    });
  }

  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label="Agent capability ceiling"
      aria-busy={pending}
      aria-describedby={errorStatus.controlProps["aria-describedby"]}
    >
      {AGENT_CAPABILITIES.map((capability) => {
        const copy = CAPABILITY_COPY[capability];
        const fieldId = `org-agent-ceiling-${capability}`;
        return (
          <div
            key={capability}
            className="border-border flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div>
              <Label htmlFor={fieldId}>{copy.label}</Label>
              <p className="text-muted-foreground text-xs">
                {copy.consequence}
              </p>
            </div>
            <Switch
              ref={capability === lastToggled ? restoreRef : undefined}
              id={fieldId}
              checked={ceiling.includes(capability)}
              disabled={pending}
              aria-label={copy.label}
              onCheckedChange={(checked) => toggle(capability, checked)}
            />
          </div>
        );
      })}
      <p className="text-muted-foreground text-xs">
        Agents can never exceed what their owner can already do. This only
        narrows it further.
      </p>
      {error && (
        <p {...errorStatus.messageProps} className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
