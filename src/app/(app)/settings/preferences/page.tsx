import { requireUser } from "@/lib/auth/session";
import {
  getUserCelebrateDoneCached,
  getUserThemePresetCached,
  getUserThemeReachCached,
  getUserTimeZoneCached,
} from "@/lib/profile/queries-cached";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { PersonalTimezoneForm } from "@/components/settings/personal-timezone-form";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { ThemePresetForm } from "@/components/settings/theme-preset-form";
import { ThemeReachForm } from "@/components/settings/theme-reach-form";
import { CelebrateDoneForm } from "@/components/settings/celebrate-done-form";

export const metadata = { title: "Preferences · Settings" };

export default async function PreferencesSettingsPage() {
  const user = await requireUser();
  const [timeZone, themePreset, themeReach, celebrateDone] = await Promise.all([
    getUserTimeZoneCached(user.id),
    getUserThemePresetCached(user.id),
    getUserThemeReachCached(user.id),
    getUserCelebrateDoneCached(user.id),
  ]);

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
      <SettingRow
        label="Theme"
        description="Accent and surface tint. Applies to light and dark."
      >
        <ThemePresetForm currentPreset={themePreset} />
      </SettingRow>
      <SettingRow
        label="Theme reach"
        description="How far your theme colour reaches into the app."
      >
        <ThemeReachForm currentReach={themeReach} />
      </SettingRow>
      <SettingRow
        label="Celebrate completed items"
        description="A short animation when you mark an item done."
      >
        <CelebrateDoneForm initialCelebrateDone={celebrateDone} />
      </SettingRow>
    </SettingsSection>
  );
}
