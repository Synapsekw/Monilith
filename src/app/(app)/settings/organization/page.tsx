import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { isOrgAdminCached } from "@/lib/org/guard";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { OrgNameForm } from "@/components/settings/org-name-form";
import { TimezoneForm } from "@/components/settings/timezone-form";

export const metadata = { title: "Organization · Settings" };

export default async function OrganizationSettingsPage() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");
  const isAdmin = await isOrgAdminCached(user.id, org.id);

  return (
    <SettingsSection
      title="Organization"
      description="General settings for your organization."
    >
      <SettingRow
        label="Name"
        description={
          isAdmin
            ? "Shown across Pulse and in invitation emails."
            : "Only owners and admins can change the organization name."
        }
      >
        <OrgNameForm orgId={org.id} currentName={org.name} canEdit={isAdmin} />
      </SettingRow>
      <SettingRow
        label="Time zone"
        description="Date automations fire at 8:00 AM in this timezone."
      >
        <TimezoneForm orgId={org.id} currentTimezone={org.timezone ?? "UTC"} />
      </SettingRow>
    </SettingsSection>
  );
}
