"use client";

import { Kicker } from "@/components/ui/kicker";

export type DockAgent = { id: string; name: string };

/**
 * Choose the persona for a NEW thread. "Ask" is the first entry with a null id
 * — one control and one prompt path, not two engines. Once a thread exists its
 * persona is fixed on the conversation row, so mid-thread this is disabled and
 * simply reports which persona the open thread belongs to.
 *
 * A native `select`, not a Radix menu: it is one element with real `option`
 * roles, it is keyboard- and screen-reader-correct for free, and on a phone it
 * gets the platform picker. Keystone styling is a hairline that brightens, so
 * it reads as chrome rather than as a second primary control in a 320px header.
 */
export function AgentSwitcher({
  agents,
  value,
  disabled,
  onChange,
}: {
  agents: DockAgent[];
  value: string | null;
  disabled?: boolean;
  onChange: (agentId: string | null) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1.5">
      <Kicker className="shrink-0">Agent</Kicker>
      <select
        value={value ?? ""}
        disabled={disabled}
        title={
          disabled
            ? "This thread's agent is fixed. Start a new thread to switch."
            : undefined
        }
        onChange={(e) => onChange(e.target.value || null)}
        className="text-foreground bg-surface hover:border-border-hover focus-visible:border-ring focus-visible:ring-ring/50 h-7 min-w-0 flex-1 truncate rounded-md border border-transparent px-1.5 text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50"
      >
        <option value="">Ask</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}
