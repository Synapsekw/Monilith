import { z } from "zod";

/**
 * Client-safe shared config for the F14 Autopilot agent: the task vocabulary,
 * cadences, and the Zod schemas the `AutopilotCard` and its server actions
 * validate against. Kept free of `server-only` (unlike `autopilot.ts` /
 * `board-agents-db.ts`) so the client card can import the constants + types.
 */

/** The housekeeping tasks a board agent can run (spec §4.3). Each maps to
 *  exactly one reversible action the confined applier is allowed to take. */
export const AUTOPILOT_TASKS = [
  "triage",
  "chase_overdue",
  "goal_rollup",
] as const;
export type AutopilotTask = (typeof AUTOPILOT_TASKS)[number];

export const AUTOPILOT_CADENCES = ["daily", "hourly"] as const;
export type AutopilotCadence = (typeof AUTOPILOT_CADENCES)[number];

/** The bounded config persisted on a board agent: which housekeeping tasks run. */
export const boardAgentConfigSchema = z.object({
  tasks: z.array(z.enum(AUTOPILOT_TASKS)).default([]),
});
export type BoardAgentConfig = z.infer<typeof boardAgentConfigSchema>;

/** Full settings payload the AutopilotCard saves (validated at the boundary). */
export const boardAgentSettingsSchema = z.object({
  enabled: z.boolean(),
  cadence: z.enum(AUTOPILOT_CADENCES),
  runAtLocalHour: z.number().int().min(0).max(23),
  tasks: z.array(z.enum(AUTOPILOT_TASKS)),
});
export type BoardAgentSettings = z.infer<typeof boardAgentSettingsSchema>;
