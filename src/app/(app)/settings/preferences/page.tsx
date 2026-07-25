import { requireUser } from "@/lib/auth/session";
import { getUserTimeZoneCached } from "@/lib/profile/queries-cached";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { PersonalTimezoneForm } from "@/components/settings/personal-timezone-form";
import { AppearanceForm } from "@/components/settings/appearance-form";

export const metadata = { title: "Preferences · Settings" };

export default async function PreferencesSettingsPage() {
  const user = await requireUser();
  const timeZone = await getUserTimeZoneCached(user.id);

  return (
    <SettingsSection
      title="Preferences"
      description="Personal settings for your account."
    >
      <SettingRow
        label="Time zone"
        description="Dates and reminders are shown in this zone. Automatic follows your device."
      >
        <PersonalTimezoneForm currentTimezone={timeZone} />
      </SettingRow>
      <SettingRow
        label="Appearance"
        description="Match your system or pick a theme."
      >
        <AppearanceForm />
      </SettingRow>
    </SettingsSection>
  );
}
