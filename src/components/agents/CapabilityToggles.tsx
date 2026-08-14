"use client";

import {
  AGENT_CAPABILITIES,
  type AgentCapability,
} from "@/lib/agents/capabilities";
import { CAPABILITY_COPY } from "@/lib/agents/capability-copy";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** Shown on a toggle the org's `agentCapabilityCeiling` does not include. The
 *  grant/ceiling intersection happens again at RUN time regardless of what
 *  this form saves — disabling here is purely so an owner cannot set a grant
 *  they'd only discover was silently dropped from the 07:00 run. */
const CEILING_REASON = "Disabled for this organization by an admin.";

/**
 * The four capability toggles a personal agent can be granted, beyond the
 * read-only baseline every agent has today.
 *
 * A controlled list, not a form of its own: `value` is the agent's current
 * grant set, `onChange` receives the whole next set on every toggle, and the
 * caller (`AgentEditor`) is what actually saves it. A capability outside
 * `ceiling` renders disabled — including one that is already granted, since a
 * ceiling can tighten after the grant was made and this control has no way to
 * widen it back regardless.
 */
export function CapabilityToggles({
  value,
  ceiling,
  onChange,
  disabled = false,
}: {
  value: AgentCapability[];
  /** `OrgAiSettings.agentCapabilityCeiling`, read by the server component
   *  that renders the editor's page. */
  ceiling: AgentCapability[];
  onChange: (next: AgentCapability[]) => void;
  /** Set while the surrounding form is saving/deleting — same convention as
   *  every other field in `AgentEditor`. */
  disabled?: boolean;
}) {
  function toggle(capability: AgentCapability, checked: boolean) {
    onChange(
      checked ? [...value, capability] : value.filter((c) => c !== capability),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {AGENT_CAPABILITIES.map((capability) => {
        const copy = CAPABILITY_COPY[capability];
        const overCeiling = !ceiling.includes(capability);
        const fieldId = `agent-capability-${capability}`;
        return (
          <div
            key={capability}
            className="flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div>
              <Label htmlFor={fieldId}>{copy.label}</Label>
              <p className="text-muted-foreground text-xs">
                {copy.consequence}
              </p>
              {overCeiling ? (
                <p className="text-destructive text-xs">{CEILING_REASON}</p>
              ) : null}
            </div>
            <Switch
              id={fieldId}
              checked={value.includes(capability)}
              disabled={disabled || overCeiling}
              aria-label={copy.label}
              onCheckedChange={(checked) => toggle(capability, checked)}
            />
          </div>
        );
      })}
      <p className="text-muted-foreground text-xs">
        Anything not granted here is recorded as a proposal for you to approve,
        instead of being blocked.
      </p>
    </div>
  );
}
