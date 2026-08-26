"use client";

import {
  AGENT_CAPABILITIES,
  type AgentCapability,
} from "@/lib/agents/capabilities";
import { CAPABILITY_COPY } from "@/lib/agents/capability-copy";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useFieldStatus } from "@/components/ui/field-status";

/** Shown on a toggle the org's `agentCapabilityCeiling` does not include. The
 *  grant/ceiling intersection happens again at RUN time regardless of what
 *  this form saves — disabling here is purely so an owner cannot set a grant
 *  they'd only discover was silently dropped from the 07:00 run. */
const CEILING_REASON = "Disabled for this organization by an admin.";

/**
 * One capability row. Its own component rather than an inline `.map` body so
 * `useFieldStatus` can run per row (hooks can't be called in a loop callback):
 * the consequence line and the ceiling reason are the switch's accessible
 * DESCRIPTION, so a screen-reader user who lands on a disabled toggle hears
 * WHY it is disabled instead of a dead control with no explanation.
 *
 * Tone is `info`, not `error`: a capability outside the org ceiling is a state
 * of the world, not something the owner typed wrong — `aria-invalid` would be
 * a lie and `role="alert"` would interrupt for a message that was there before
 * they arrived.
 */
function CapabilityRow({
  capability,
  granted,
  overCeiling,
  disabled,
  onToggle,
}: {
  capability: AgentCapability;
  granted: boolean;
  overCeiling: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const copy = CAPABILITY_COPY[capability];
  const fieldId = `agent-capability-${capability}`;
  const consequenceId = `${fieldId}-consequence`;
  const ceilingStatus = useFieldStatus(
    overCeiling ? CEILING_REASON : null,
    "info",
    consequenceId,
  );

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div>
        <Label htmlFor={fieldId}>{copy.label}</Label>
        <p id={consequenceId} className="text-muted-foreground text-xs">
          {copy.consequence}
        </p>
        {overCeiling ? (
          <p
            {...ceilingStatus.messageProps}
            className="text-destructive text-xs"
          >
            {CEILING_REASON}
          </p>
        ) : null}
      </div>
      <Switch
        id={fieldId}
        checked={granted}
        disabled={disabled || overCeiling}
        aria-label={copy.label}
        {...ceilingStatus.controlProps}
        onCheckedChange={onToggle}
      />
    </div>
  );
}

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
      {AGENT_CAPABILITIES.map((capability) => (
        <CapabilityRow
          key={capability}
          capability={capability}
          granted={value.includes(capability)}
          overCeiling={!ceiling.includes(capability)}
          disabled={disabled}
          onToggle={(checked) => toggle(capability, checked)}
        />
      ))}
      <p className="text-muted-foreground text-xs">
        Anything not granted here is recorded as a proposal for you to approve,
        instead of being blocked.
      </p>
    </div>
  );
}
