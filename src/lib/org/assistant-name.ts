import { z } from "zod";

/**
 * The platform bot's display name, per ORG.
 *
 * It used to be one `profiles.full_name` for the whole deployment
 * (20260727122214 renamed it once, by hand). The underlying `auth.users` row
 * stays global and its email stays `pulse-autopilot@pulse.internal` on purpose:
 * `platform_agent_user_id()` resolves the bot BY THAT EMAIL, so renaming the
 * identity would break the resolver. Only the display name is per-org.
 *
 * Deliberately NOT a `server-only` module: the constant and the schema are
 * shared by the Server Action that writes the column and the client form that
 * validates the field before it is sent, so both halves refuse the same names.
 */
export const DEFAULT_ASSISTANT_NAME = "Monolith Autopilot";

/**
 * The app-side mirror of the column's own constraint,
 * `check (length(trim(assistant_name)) between 1 and 40)`. Zod's `.trim()` runs
 * BEFORE the length checks, so padding is not length here either — the two
 * agree on every input, and a name the form accepts can never be a 500 from
 * Postgres with no field to attach it to.
 *
 * The name is DISPLAY ONLY: it never addresses anything, so it is not
 * constrained to the `@handle` grammar (see the column comment).
 */
export const assistantNameSchema = z.string().trim().min(1).max(40);

/**
 * The `maxLength` the rename field caps typing at, read OFF the schema rather
 * than restated — the input, the action and the column constraint cannot drift
 * to three different numbers this way.
 */
export const ASSISTANT_NAME_MAX_LENGTH: number =
  assistantNameSchema.maxLength ?? 40;

/**
 * What to CALL the assistant, given whatever the column holds.
 *
 * Every render site takes the resolved value, never the raw column, because
 * the fallback has to hold in three separate cases the column type does not
 * describe: an org with no `org_ai_settings` row at all, a row read through a
 * select list that predates the column, and — should the check constraint ever
 * be dropped — a blank name that would render as an empty label. Falls back
 * rather than throwing: an unusable name is a cosmetic problem, and refusing
 * to render the board settings card over it would not be.
 */
export function resolveAssistantName(
  stored: string | null | undefined,
): string {
  const parsed = assistantNameSchema.safeParse(stored ?? "");
  return parsed.success ? parsed.data : DEFAULT_ASSISTANT_NAME;
}
