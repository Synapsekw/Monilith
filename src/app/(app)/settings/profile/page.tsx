import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { ProfileForm } from "@/components/settings/profile-form";

export const metadata = { title: "Profile · Settings" };

/** Reads only the profile row — the old combined page fetched ten queries. */
export default async function ProfileSettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <SettingsSection
      title="Profile"
      description="How you appear to your teammates."
    >
      <ProfileForm
        userId={user.id}
        currentFullName={profile?.full_name ?? null}
        currentAvatarUrl={profile?.avatar_url ?? null}
      />
      <SettingRow
        label="Email"
        description="The address you sign in with. Change it under Security."
      >
        <p className="text-muted-foreground text-sm break-all">{user.email}</p>
      </SettingRow>
    </SettingsSection>
  );
}
