import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { SignOutEverywhereButton } from "@/components/settings/security-actions";
import { DangerZone } from "@/components/settings/danger-zone";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Security · Settings" };

export default async function SecuritySettingsPage() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");

  return (
    <>
      <SettingsSection
        title="Security"
        description="Keep your account and sessions under control."
      >
        <SettingRow label="Email" description="The address you sign in with.">
          <p className="text-muted-foreground text-sm break-all">
            {user.email}
          </p>
        </SettingRow>
        <SettingRow
          label="Password"
          description="Change the password used to sign in."
        >
          <Button asChild variant="outline" size="sm">
            <Link href="/change-password">Change password</Link>
          </Button>
        </SettingRow>
        <SettingRow
          label="Active sessions"
          description="Signs you out of Pulse everywhere, including devices you no longer have."
        >
          <SignOutEverywhereButton />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Danger zone"
        description="These actions can't be undone from here."
      >
        <SettingRow
          label="Leave organization"
          description={`Remove yourself from ${org.name}. You'll need a new invite to return.`}
        >
          <DangerZone orgId={org.id} orgName={org.name} />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
