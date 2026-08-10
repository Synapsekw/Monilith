import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { isOrgAdminCached } from "@/lib/org/guard";
import { listMyAiCredentials } from "@/lib/ai/credentials";
import { getOrgAiSettings } from "@/lib/ai/settings-actions";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { AiProviderForm } from "@/components/settings/AiProviderForm";
import { OrgAiSettingsForm } from "@/components/settings/OrgAiSettingsForm";

export const metadata = { title: "AI · Settings" };

/**
 * One AI page. The old settings page showed two sibling cards — "AI —
 * Organization" and "AI" — whose relationship was invisible: the personal card
 * degraded to a lone sentence in a box whenever the org managed AI centrally.
 * Here the org policy comes first (admins only) and the personal key reads as
 * a consequence of it.
 */
export default async function AiSettingsPage() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");

  const [credentials, orgAi, isAdmin] = await Promise.all([
    listMyAiCredentials(),
    getOrgAiSettings(),
    isOrgAdminCached(user.id, org.id),
  ]);
  // INTERIM: AiProviderForm still renders a single credential. A user can now
  // hold one key per provider (Task 1); Task 9 replaces this with a real
  // multi-key list UI. Until then, show whichever key sorts first.
  const aiCredential = credentials[0] ?? null;

  const orgAiMode = orgAi.ok ? orgAi.data.mode : null;
  const personalKeyManaged = orgAiMode !== null && orgAiMode !== "per_user";

  return (
    <>
      {isAdmin && orgAi.ok && (
        <SettingsSection
          title="Organization AI"
          description="How AI features are powered for everyone in this org."
        >
          <div className="pt-4">
            <OrgAiSettingsForm initial={orgAi.data} />
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        title="Your AI provider"
        description={
          personalKeyManaged
            ? "AI is powered by your organization's settings."
            : "Your provider key powers dashboard generation and other AI features."
        }
      >
        {personalKeyManaged ? (
          <SettingRow
            label="Provider key"
            description="Managed by your organization — no personal key needed."
          >
            <p className="text-muted-foreground text-sm">Nothing to do here.</p>
          </SettingRow>
        ) : (
          // Full width, not a SettingRow: this is a multi-field form (provider
          // chips + key + validate), and a 280px control column wraps it into
          // an unreadable stack.
          <div className="pt-4">
            <AiProviderForm initial={aiCredential} />
          </div>
        )}
      </SettingsSection>
    </>
  );
}
