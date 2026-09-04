import type { AgentCapability } from "./capabilities";

/**
 * The plain-language copy for each capability — label and one-line
 * consequence, verbatim per the Task 8 brief. The ONE place this copy lives:
 * both `CapabilityToggles` (the per-agent grant editor) and `OrgAgentCeiling`
 * (the org-wide clamp on what any agent may be granted) render the same
 * capabilities from this table rather than each declaring their own. Free of
 * `server-only`, like `capabilities.ts`, so client components can import it.
 */
export const CAPABILITY_COPY: Record<
  AgentCapability,
  { label: string; consequence: string }
> = {
  "board.write": {
    label: "Create and update items",
    consequence:
      "This agent can add items and change field values on boards in its scope.",
  },
  "files.write": {
    label: "Create and attach files",
    consequence: "This agent can write documents and attach them to items.",
  },
  "automation.create": {
    label: "Create board automations",
    consequence: "This agent can create rules that later run on their own.",
  },
  "time.log": {
    label: "Log time",
    consequence: "This agent can record time allocations against items.",
  },
  "memory.write": {
    label: "Remember what it learns",
    consequence:
      "This agent can keep short notes between runs, and read them back at the " +
      "start of every run. You can see, edit and delete everything it remembers.",
  },
};
