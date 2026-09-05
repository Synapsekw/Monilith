import { z } from "zod";

/**
 * A handle is the TYPEABLE name of an agent. Free of `server-only`: the mention
 * autocomplete, the agent editor and the migration's backfill all speak it.
 *
 * The shape is dictated by `activeMentionQuery` (src/lib/collaboration/mentions.ts),
 * which terminates a mention token at the first whitespace — so a handle may not
 * contain one. Lowercase-only keeps `unique (owner_id, lower(handle))` and the
 * typed token in agreement without a case-folding step at every call site.
 *
 * Mirrors, exactly, `user_agents_handle_shape` and
 * `user_agents_handle_not_reserved` in the agent_handles_and_builtin migration.
 * `handle-parity.test.ts` fails if the two lists drift.
 */
export const HANDLE_MIN = 2;
export const HANDLE_MAX = 32;

/** Names that must never address one person's agent, because they read as
 *  addressing everyone, the platform, or an administrator. */
export const RESERVED_HANDLES = [
  "here",
  "all",
  "everyone",
  "channel",
  "admin",
  "system",
  "monolith",
  "support",
  "none",
  "me",
] as const;

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

export const handleSchema = z
  .string()
  .trim()
  .min(HANDLE_MIN, `Handle must be at least ${HANDLE_MIN} characters.`)
  .max(HANDLE_MAX, `Handle must be at most ${HANDLE_MAX} characters.`)
  .regex(
    HANDLE_RE,
    "Use lowercase letters, numbers and hyphens; start with a letter or number.",
  )
  .refine((h) => !(RESERVED_HANDLES as readonly string[]).includes(h), {
    message: "That handle is reserved.",
  });

/**
 * Derive a legal handle from a display name. TOTAL by construction — every
 * input produces something `handleSchema` accepts, because the caller (the
 * editor's prefill, and the migration's backfill) has no second chance.
 */
export function slugifyHandle(name: string, id: string): string {
  const fallback = `agent-${id.replace(/-/g, "").slice(0, 8)}`;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, HANDLE_MAX);
  if (slug.length < HANDLE_MIN) return fallback;
  if ((RESERVED_HANDLES as readonly string[]).includes(slug)) return fallback;
  return slug;
}
