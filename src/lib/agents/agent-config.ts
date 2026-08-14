import { z } from "zod";
import { AGENT_CAPABILITIES } from "./capabilities";

/**
 * Client-safe shared config for personal agents: the template gallery, cadences
 * and the Zod schemas the roster UI and its server actions validate against.
 * Deliberately free of `server-only` (unlike `agents-db.ts`) so the editor can
 * import the constants and types. Mirrors `ai/agentic/autopilot-config.ts`.
 */

/** Instructions are user-authored free text; capped so one agent cannot blow
 *  the prompt budget or the row size. Mirrors `user_agents_instructions_check`
 *  — the two move together or the UI offers a prompt the database refuses. */
export const INSTRUCTIONS_MAX = 8000;

/** Mirrors `user_agents_cadence_check`. */
export const AGENT_CADENCES = [
  "daily",
  "weekdays",
  "weekly",
  "monthly",
] as const;
export type AgentCadence = (typeof AGENT_CADENCES)[number];

/** Mirrors the `user_agents_capabilities_known` check constraint. A set, not a
 *  list: order carries no meaning and duplicates are a bug. The vocabulary
 *  itself is imported — `src/lib/agents/capabilities.ts` is its one home. */
export const capabilitySchema = z
  .array(z.enum(AGENT_CAPABILITIES))
  .max(AGENT_CAPABILITIES.length)
  .refine((v) => new Set(v).size === v.length, "Duplicate capability.");

/** Which boards the agent reads. `all` means "everything the owner can see" —
 *  the owner's RLS, not a stored list, is what actually bounds it. */
export const boardScopeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({
    mode: z.literal("list"),
    boardIds: z.array(z.string().uuid()).min(1).max(50),
  }),
]);
export type BoardScope = z.infer<typeof boardScopeSchema>;

/** Full settings payload the editor saves (validated at the boundary). */
export const personalAgentSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    templateId: z.string().min(1).max(64),
    instructions: z.string().trim().min(1).max(INSTRUCTIONS_MAX),
    boardScope: boardScopeSchema,
    cadence: z.enum(AGENT_CADENCES),
    runAtLocalHour: z.number().int().min(0).max(23),
    enabled: z.boolean(),
    /**
     * The per-agent model PIN, written to `user_agents.provider` /
     * `user_agents.model_id`. Both null means "inherit the org default" — the
     * backfill value of every agent that predates the pin, hence the defaults.
     *
     * `modelId` is the CATALOG key (`ai_models.model_id`), never the provider's
     * wire id: `native_model_id` is resolved per run (`resolveModel`) and only
     * an adapter ever sees it, so pinning one would be unreadable by the picker
     * and by the usage ledger, which both speak the catalog key.
     *
     * Open strings rather than enums on purpose: the provider registry is
     * DB-driven, so a fixed union here would reject a provider the deployment
     * has legitimately enabled. `provider` carries an FK to `ai_providers`, and
     * an unknown or retired `model_id` is a documented run-time substitution,
     * not a save-time failure.
     */
    provider: z.string().trim().min(1).max(64).nullable().default(null),
    modelId: z.string().trim().min(1).max(128).nullable().default(null),
    /**
     * What this agent is allowed to DO, on top of what it can read. Defaults to
     * the empty set, which is the whole safety story of this feature: an editor
     * that predates the capability picker sends no key at all, and that agent
     * stays exactly as read-only as it is today. Granting is always an explicit
     * act, and the grant is still clamped at run time by the org's
     * `agent_capability_ceiling` and by the owner's own RLS.
     */
    capabilities: capabilitySchema.default([]),
    /**
     * The cadence's day operand. Null on both is the daily/weekdays shape —
     * which is every agent that predates cadences, hence the defaults. 0-6 is
     * Sunday-Saturday, matching Postgres `extract(dow …)` so the sweep's
     * predicate needs no translation; 28 is the day-of-month ceiling because it
     * is the largest day present in every month, so no agent silently skips
     * February.
     */
    runOnWeekday: z.number().int().min(0).max(6).nullable().default(null),
    runOnDayOfMonth: z.number().int().min(1).max(28).nullable().default(null),
  })
  // Both halves or neither. A model without a provider names nothing —
  // `resolveModel` reads the catalog one provider at a time. A provider
  // without a model would be resolvable at run time, but the editor's picker
  // can only express a concrete model, so allowing that half-state would mean
  // the editor silently clears a pin it cannot display. The pair is therefore
  // validated together, and the error is filed on `provider` because that is
  // the half a picked model can be missing.
  .refine((v) => (v.provider === null) === (v.modelId === null), {
    message: "Pick a provider and a model together, or neither.",
    path: ["provider"],
  })
  // Mirrors `user_agents_cadence_fields` EXACTLY — same combinations legal,
  // same combinations rejected. Both halves or neither, per cadence: a weekly
  // agent with no weekday would never fire, which is worse than refusing the
  // write, and a daily agent carrying a weekday states a rule nothing reads.
  // Zod has to be the one that says so, because the alternative is a check
  // violation the user reads as "Couldn't save that agent". The error is filed
  // on `cadence` — that is the control the user operates; `runOnWeekday` is a
  // field the editor only shows once the cadence is already weekly.
  .refine(cadenceFieldsMatch, {
    message: "That cadence needs exactly one day setting.",
    path: ["cadence"],
  });
export type PersonalAgentSettings = z.infer<typeof personalAgentSettingsSchema>;

/** The TypeScript twin of the `user_agents_cadence_fields` check constraint.
 *  Exhaustive over `AgentCadence` on purpose: adding a cadence without deciding
 *  its day operand becomes a compile error rather than a silently-legal row. */
function cadenceFieldsMatch(v: {
  cadence: AgentCadence;
  runOnWeekday: number | null;
  runOnDayOfMonth: number | null;
}): boolean {
  const weekday = v.runOnWeekday !== null;
  const dayOfMonth = v.runOnDayOfMonth !== null;
  switch (v.cadence) {
    case "daily":
    case "weekdays":
      return !weekday && !dayOfMonth;
    case "weekly":
      return weekday && !dayOfMonth;
    case "monthly":
      return !weekday && dayOfMonth;
  }
}

export type AgentTemplate = {
  id: string;
  name: string;
  /** One-line gallery description. */
  blurb: string;
  instructions: string;
  boardScope: BoardScope;
  cadence: AgentCadence;
  runAtLocalHour: number;
};

/**
 * The four starter roles. Seeds only — everything stays editable afterwards.
 *
 * Each instruction now NAMES the tool to call. The run is a tool loop, not a
 * pre-built briefing handed to a summariser: an instruction that says "look at
 * what is due today" leaves the model to guess which of two dozen tools that
 * means, and a scheduled agent that guesses wrong produces an empty report
 * every morning with nothing in the run row to explain it.
 */
export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "morning-brief",
    name: "Morning Brief",
    blurb: "A short summary of what's pending, every morning.",
    instructions:
      "Call get_my_work, then write a brief, friendly summary of what I need to do today. Lead with anything overdue, then what's due today, then the rest of the week. Be concise — no more than a short paragraph per section. Do not invent items that get_my_work did not return.",
    boardScope: { mode: "all" },
    cadence: "daily",
    runAtLocalHour: 7,
  },
  {
    id: "overdue-chaser",
    name: "Overdue Chaser",
    blurb: "Focuses only on what has already slipped.",
    instructions:
      "Call get_my_work, then list only the overdue items, most overdue first. For each, state how late it is and which board it's on. Be direct and short. If nothing is overdue, say so in one line and stop.",
    boardScope: { mode: "all" },
    cadence: "daily",
    runAtLocalHour: 8,
  },
  {
    id: "risk-spotter",
    name: "Risk Spotter",
    blurb: "Flags what looks likely to slip next.",
    instructions:
      "Call get_my_work, then call out what is most at risk of slipping among the items due today and this week, with a one-line reason each. Prioritise by due date and how much is stacked on the same day. Do not speculate beyond what the tools returned.",
    boardScope: { mode: "all" },
    cadence: "daily",
    runAtLocalHour: 7,
  },
  {
    id: "standup-writer",
    name: "Standup Writer",
    blurb: "Drafts your standup update from your assigned work.",
    instructions:
      "Call get_my_work, then draft a standup update in three short sections: what's due today, what's overdue, and what's coming this week. Write it in the first person, as bullet points I could paste into a chat.",
    boardScope: { mode: "all" },
    cadence: "daily",
    runAtLocalHour: 9,
  },
];
