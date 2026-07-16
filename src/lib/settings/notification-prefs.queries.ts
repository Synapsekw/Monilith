import { createClient } from "@/lib/supabase/server";
import {
  CONTROLLABLE_IN_APP_KINDS,
  type AppNotificationPrefKind,
} from "@/lib/settings/notification-prefs";

/**
 * The set of controllable in-app kinds the given user has DISABLED. Bounded,
 * PK-indexed read (opt-out rows only). Used for first paint of the settings
 * form. RLS scopes it to the caller, but we pass userId for an explicit filter.
 */
export async function getDisabledInAppKinds(
  userId: string,
): Promise<Set<AppNotificationPrefKind>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notification_preferences")
    .select("kind")
    .eq("user_id", userId)
    .eq("channel", "in_app");

  const controllable = new Set<string>(CONTROLLABLE_IN_APP_KINDS);
  const disabled = new Set<AppNotificationPrefKind>();
  for (const row of data ?? []) {
    if (controllable.has(row.kind))
      disabled.add(row.kind as AppNotificationPrefKind);
  }
  return disabled;
}
