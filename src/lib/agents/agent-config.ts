import { z } from "zod";

/**
 * Client-safe shared config for personal agents: the template gallery, cadences
 * and the Zod schemas the roster UI and its server actions validate against.
 * Deliberately free of `server-only` (unlike `agents-db.ts`) so the editor can
 * import the constants and types. Mirrors `ai/agentic/autopilot-config.ts`.
 */

/** Instructions are user-authored free text; capped so one agent cannot blow
 *  the prompt budget or the row size. */
export const INSTRUCTIONS_MAX = 2000;

export const AGENT_CADENCES = ["daily"] as const;
export type AgentCadence = (typeof AGENT_CADENCES)[number];

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
export const personalAgentSettingsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  templateId: z.string().min(1).max(64),
  instructions: z.string().trim().min(1).max(INSTRUCTIONS_MAX),
  boardScope: boardScopeSchema,
  cadence: z.enum(AGENT_CADENCES),
  runAtLocalHour: z.number().int().min(0).max(23),
  enabled: z.boolean(),
});
export type PersonalAgentSettings = z.infer<typeof personalAgentSettingsSchema>;

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

/** The four starter roles. Seeds only — everything stays editable afterwards. */
export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "morning-brief",
    name: "Morning Brief",
    blurb: "A short summary of what's pending, every morning.",
    instructions:
      "Write a brief, friendly summary of what I need to do today. Lead with anything overdue, then what's due today, then the rest of the week. Be concise — no more than a short paragraph per section. Do not invent items that are not in the data.",
    boardScope: { mode: "all" },
    cadence: "daily",
    runAtLocalHour: 7,
  },
  {
    id: "overdue-chaser",
    name: "Overdue Chaser",
    blurb: "Focuses only on what has already slipped.",
    instructions:
      "List only overdue items, most overdue first. For each, state how late it is and which board it's on. Be direct and short. If nothing is overdue, say so in one line and stop.",
    boardScope: { mode: "all" },
    cadence: "daily",
    runAtLocalHour: 8,
  },
  {
    id: "risk-spotter",
    name: "Risk Spotter",
    blurb: "Flags what looks likely to slip next.",
    instructions:
      "Look at what is due today and this week and call out what is most at risk of slipping, with a one-line reason each. Prioritise by due date and how much is stacked on the same day. Do not speculate beyond the data given.",
    boardScope: { mode: "all" },
    cadence: "daily",
    runAtLocalHour: 7,
  },
  {
    id: "standup-writer",
    name: "Standup Writer",
    blurb: "Drafts your standup update from your assigned work.",
    instructions:
      "Draft a standup update in three short sections: what's due today, what's overdue, and what's coming this week. Write it in the first person, as bullet points I could paste into a chat.",
    boardScope: { mode: "all" },
    cadence: "daily",
    runAtLocalHour: 9,
  },
];
