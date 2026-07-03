"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

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
