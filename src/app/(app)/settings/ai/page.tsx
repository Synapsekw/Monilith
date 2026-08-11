import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { isOrgAdminCached } from "@/lib/org/guard";
import { createClient } from "@/lib/supabase/server";
import { listMyAiCredentials } from "@/lib/ai/credentials";
import { listEnabledProviders } from "@/lib/ai/providers/provider-rows";
import { getOrgAiSettings } from "@/lib/ai/settings-actions";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { AiKeyList } from "@/components/settings/AiKeyList";
import { OrgAiSettingsForm } from "@/components/settings/OrgAiSettingsForm";

export const metadata = { title: "AI · Settings" };

/**
 * One AI page. The old settings page showed two sibling cards — "AI —
 * Organization" and "AI" — whose relationship was invisible: the personal card
 * degraded to a lone sentence in a box whenever the org managed AI centrally.
 * Here the org policy comes first (admins only) and the personal keys read as
 * a consequence of it.
 *
 * This page shows keys, not models, and that is a decision rather than an
 * omission. `saveAiKey` verifies a provider's model ids in an `after()`
 * callback while `revalidatePath("/settings/ai")` fires on the response path,
 * so a re-render can beat verification. Any model count or model list rendered
 * here would show a provider with a saved key and zero models for a second or
 * two — a real product looking broken. Model choice belongs to the pickers
 * that select one (org default, per-agent), where the list is read after the
 * fact and an empty one can be explained.
 *
 * Data budget: two bounded reads. `user_ai_credentials` is at most one row per
 * provider for one user (indexed on `user_id`); `ai_providers` is the registry
 * itself, filtered to `enabled`. Every in-page interaction — opening a key
 * field, cancelling, switching rows — is client state in `AiKeyList` and costs
 * zero server round-trips; only the two mutations talk to the server.
 */
export default async function AiSettingsPage() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");

  const supabase = await createClient();
  const [credentials, providers, orgAi, isAdmin] = await Promise.all([
    listMyAiCredentials(),
    listEnabledProviders(supabase),
    getOrgAiSettings(),
    isOrgAdminCached(user.id, org.id),
  ]);

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
        title="Your AI providers"
        description={
          personalKeyManaged
            ? "AI is powered by your organization's settings."
            : "Add a key for each provider you want to use. Saving a key also makes that provider's models available to you."
        }
      >
        {personalKeyManaged ? (
          <SettingRow
            label="Provider keys"
            description="Managed by your organization — no personal key needed."
          >
            <p className="text-muted-foreground text-sm">Nothing to do here.</p>
          </SettingRow>
        ) : (
          // Full width, not a SettingRow: each row carries its own key field
          // and buttons, and a 280px control column wraps that into an
          // unreadable stack.
          <AiKeyList providers={providers} initial={credentials} />
        )}
      </SettingsSection>
    </>
  );
}
