import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { isOrgAdminCached } from "@/lib/org/guard";
import { createClient } from "@/lib/supabase/server";
import { listMyAiCredentials } from "@/lib/ai/credentials";
import { listEnabledProviders } from "@/lib/ai/providers/provider-rows";
import { buildModelOptions } from "@/lib/ai/models/model-options";
import { getOrgAiSettings } from "@/lib/ai/settings-actions";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { AiKeyList } from "@/components/settings/AiKeyList";
import { OrgAiSettingsForm } from "@/components/settings/OrgAiSettingsForm";
import { OrgAgentCeiling } from "@/components/settings/OrgAgentCeiling";
import type { ModelOption } from "@/components/settings/ModelPicker";

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
 * The org default-model picker is the one place model state IS shown, and that
 * is consistent with the paragraph above: it is read long after any key was
 * saved (a page load, not a post-save re-render), and an empty list here has a
 * true, actionable explanation — a provider's catalog ids can only be verified
 * with that provider's own key, so "no models yet" means "no key yet" and says
 * so, per provider.
 *
 * Data budget: bounded reads, all on first paint. `user_ai_credentials` is at
 * most one row per provider for one user (indexed on `user_id`); `ai_providers`
 * is the registry itself, filtered to `enabled`; the catalog read is one
 * `listActiveModels` per enabled provider, run in parallel and served by
 * `ai_models_selectable_idx` (status + provider + id_verified) — tens of rows
 * each, and only for an admin, who is the only one who sees the org form.
 * Every in-page interaction — opening a key field, cancelling, switching rows,
 * opening the model picker, searching it, switching provider inside it — is
 * client state and costs zero server round-trips. Only the mutations talk to
 * the server. No `<Link>`/`router` navigation is involved anywhere in this
 * page's interactions, so no query is ever re-run to change a view.
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

  // Only an admin sees the org form, so only an admin pays for the catalog
  // reads. `buildModelOptions` returns one flat list, sorted providers-by-label
  // (the order `listEnabledProviders` returns) and cheapest-first within a
  // provider (the order `listActiveModels` returns) — the picker groups it
  // without re-sorting. Shared with Settings → Agents, which needs the same
  // list for the per-agent pin.
  const modelOptions: ModelOption[] =
    isAdmin && orgAi.ok ? await buildModelOptions(supabase, providers) : [];

  return (
    <>
      {isAdmin && orgAi.ok && (
        <SettingsSection
          title="Organization AI"
          description="How AI features are powered for everyone in this org."
        >
          <div className="pt-4">
            <OrgAiSettingsForm
              initial={orgAi.data}
              providers={providers}
              modelOptions={modelOptions}
            />
          </div>
        </SettingsSection>
      )}

      {isAdmin && orgAi.ok && (
        <SettingsSection
          title="Agent capabilities"
          description="The most any personal agent in this organization may ever be granted."
        >
          <div className="pt-4">
            <OrgAgentCeiling initial={orgAi.data.agentCapabilityCeiling} />
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
