import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { isOrgAdminCached } from "@/lib/org/guard";
import { createClient } from "@/lib/supabase/server";
import { listMyAiCredentials } from "@/lib/ai/credentials";
import {
  listEnabledProviders,
  listProviderVerification,
} from "@/lib/ai/providers/provider-rows";
import { buildModelOptions } from "@/lib/ai/models/model-options";
import { getOrgAiSettings } from "@/lib/ai/settings-actions";
import { getUsageSummary } from "@/lib/ai/usage-summary";
import { SettingsSection } from "@/components/settings/settings-section";
import { AiKeyList } from "@/components/settings/AiKeyList";
import { ProviderVerificationList } from "@/components/settings/ProviderVerificationBadge";
import { OrgAiSettingsForm } from "@/components/settings/OrgAiSettingsForm";
import { OrgAgentCeiling } from "@/components/settings/OrgAgentCeiling";
import { UsageBreakdown } from "@/components/settings/UsageBreakdown";
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
 * is the registry itself, filtered to `enabled`, plus a second read of the same
 * five-row table for the sweep-health columns (kept separate so `ProviderRow`
 * — which four other modules and two client components consume — does not grow
 * four fields none of them use); the catalog read is one
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
  const [credentials, providers, verification, orgAi, isAdmin] =
    await Promise.all([
      listMyAiCredentials(),
      listEnabledProviders(supabase),
      listProviderVerification(supabase),
      getOrgAiSettings(),
      isOrgAdminCached(user.id, org.id),
    ]);

  // One server instant for every badge on the page, so the "N days ago"
  // strings the server renders are byte-identical to the ones that hydrate.
  //
  // react-hooks/purity is disabled here rather than dodged: this is an async
  // Server Component that runs once per request and then serializes, so there
  // is no re-render for the value to drift across — and the badge deliberately
  // has NO clock-reading default precisely so the instant is captured exactly
  // here, on the server, instead of once per client render.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

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

  // Same "only an admin pays for the extra read" pattern as `modelOptions`
  // above — `getUsageSummary` is a bounded, admin-only read folded into this
  // page's existing first-paint data, not a client fetch.
  const usage = isAdmin && orgAi.ok ? await getUsageSummary(org.id) : null;

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

      {isAdmin && orgAi.ok && usage && (
        <SettingsSection
          title="Usage"
          description="Where this month's AI spend is going."
        >
          <div className="pt-4">
            <UsageBreakdown summary={usage} />
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
          // Full width, not a SettingRow, for the same reason AiKeyList is:
          // a provider name plus its state does not fit a 280px control
          // column. The freshness is shown HERE too because this branch is
          // the org_byo/managed case — the one where a provider the sweep
          // can never borrow a key for would otherwise be invisible.
          <div className="space-y-3 py-4">
            <p className="text-muted-foreground text-sm">
              Your organization supplies the key, so there is no personal key to
              add. Model lists are refreshed daily — this is when each provider
              was last checked.
            </p>
            <ProviderVerificationList
              providers={providers}
              verification={verification}
              nowMs={nowMs}
            />
          </div>
        ) : (
          // Full width, not a SettingRow: each row carries its own key field
          // and buttons, and a 280px control column wraps that into an
          // unreadable stack.
          <AiKeyList
            providers={providers}
            initial={credentials}
            health={{ verification, nowMs }}
          />
        )}
      </SettingsSection>
    </>
  );
}
