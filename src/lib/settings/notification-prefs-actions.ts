"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/actions/result";
import { notificationPrefKindSchema } from "@/lib/settings/notification-prefs";

const inputSchema = z.object({
  kind: notificationPrefKindSchema,
  enabled: z.boolean(),
});

/**
 * Set the caller's IN-APP preference for one notification kind. Opt-out model:
 * disabling upserts a row; enabling deletes it (absence = enabled). RLS
 * ("notif prefs: write own") restricts the write to the caller's own rows.
 */
export async function setNotificationPreference(
  input: z.infer<typeof inputSchema>,
): Promise<ActionResult<null>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not signed in");

  if (parsed.data.enabled) {
    // Enable = remove the disabled row (default is enabled).
    const { error } = await supabase
      .from("notification_preferences")
      .delete()
      .eq("user_id", user.id)
      .eq("kind", parsed.data.kind)
      .eq("channel", "in_app");
    if (error) return fail(error.message);
    return { ok: true, data: null };
  }

  // Disable = record a disabled row (idempotent upsert on the PK).
  const { error } = await supabase.from("notification_preferences").upsert(
    {
      user_id: user.id,
      kind: parsed.data.kind,
      channel: "in_app",
      enabled: false,
    },
    { onConflict: "user_id,kind,channel" },
  );
  if (error) return fail(error.message);
  return { ok: true, data: null };
}
