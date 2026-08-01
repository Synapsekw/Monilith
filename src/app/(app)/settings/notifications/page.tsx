import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getDisabledInAppKinds } from "@/lib/settings/notification-prefs.queries";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { NotificationPreferencesForm } from "@/components/settings/NotificationPreferencesForm";
import { DigestPreferenceForm } from "@/components/settings/DigestPreferenceForm";
import { BriefingPreferenceForm } from "@/components/settings/BriefingPreferenceForm";

export const metadata = { title: "Notifications · Settings" };

export default async function NotificationSettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [disabledInApp, { data: profile }] = await Promise.all([
    getDisabledInAppKinds(user.id),
    supabase
      .from("profiles")
      .select("email_digest_opt_out, email_briefing_opt_out")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  return (
    <>
      <SettingsSection
        title="In-app"
        description="Which events create a notification inside Monolith."
      >
        <NotificationPreferencesForm disabledKinds={[...disabledInApp]} />
      </SettingsSection>

      <SettingsSection
        title="Email"
        description="What Monolith sends to your account address."
      >
        <SettingRow
          label="Weekly digest"
          description="A summary of plan health, sent once a week."
        >
          <DigestPreferenceForm
            initialOptOut={profile?.email_digest_opt_out ?? false}
          />
        </SettingRow>
        <SettingRow
          label="Daily agent briefing"
          description="Your personal agents' daily summary, if you have any set up in Settings → Agents."
        >
          <BriefingPreferenceForm
            initialOptOut={profile?.email_briefing_opt_out ?? false}
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
