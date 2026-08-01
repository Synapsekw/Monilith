"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/actions/result";

const inputSchema = z.object({ optOut: z.boolean() });

/**
 * Set the caller's weekly-digest EMAIL opt-out. In-app digest notifications
 * are unaffected by design. RLS ("profiles: update self") restricts the write
 * to the caller's own row.
 */
export async function setEmailDigestOptOut(
  input: z.infer<typeof inputSchema>,
): Promise<ActionResult<null>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not signed in");

  const { error } = await supabase
    .from("profiles")
    .update({ email_digest_opt_out: parsed.data.optOut })
    .eq("id", user.id);
  if (error) return fail(error.message);
  return { ok: true, data: null };
}

/**
 * Set the caller's daily agent-briefing EMAIL opt-out. Mirrors
 * setEmailDigestOptOut exactly (same RLS — "profiles: update self" — same
 * inverted storage so existing agents keep emailing by default): this is the
 * "you can turn it back on any time in Settings" recovery path the
 * unsubscribe email (`sendBriefingEmail`, `src/lib/agents/send.ts`) has
 * always promised but that nothing implemented until now — the *only* way
 * to flip `email_briefing_opt_out` back to `false` was direct DB access.
 */
export async function setEmailBriefingOptOut(
  input: z.infer<typeof inputSchema>,
): Promise<ActionResult<null>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not signed in");

  const { error } = await supabase
    .from("profiles")
    .update({ email_briefing_opt_out: parsed.data.optOut })
    .eq("id", user.id);
  if (error) return fail(error.message);
  return { ok: true, data: null };
}
