import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveOrg } from "@/lib/org/active";
import { SettingsSection } from "@/components/settings/settings-section";
import { AgentsSection } from "@/components/agents/AgentsSection";
import type { AgentRecord } from "@/components/agents/AgentEditor";
import type { AgentCadence, BoardScope } from "@/lib/agents/agent-config";
import type { AgentCapability } from "@/lib/agents/capabilities";
import { getMyAgentLastRuns } from "@/lib/agents/agents-db";
import { countPendingProposalsByAgent } from "@/lib/agents/proposals-db";
import {
  readOrgAiSettings,
  DEFAULT_ORG_AI_SETTINGS,
} from "@/lib/ai/org-settings";
import { listEnabledProviders } from "@/lib/ai/providers/provider-rows";
import { buildModelOptions } from "@/lib/ai/models/model-options";
import type { ModelOption } from "@/components/settings/ModelPicker";
import type { ProviderRow } from "@/lib/ai/providers/provider-rows";
import type { AgentRunLike } from "@/lib/agents/run-status";

export const metadata = { title: "Agents · Settings" };

/**
 * Settings → Agents. Server Component.
 *
 * First paint is FIVE bounded reads, all indexed, issued concurrently:
 *   1. the roster — `.eq("owner_id", …)` hits the (owner_id, enabled) index
 *      prefix; the select includes `instructions`/`board_scope` and the model
 *      pin alongside the roster fields so opening the editor for an existing
 *      agent is a client-state transition over data already in hand, not a
 *      round trip;
 *   2. `get_my_agent_last_runs()` — one `distinct on` over
 *      user_agent_runs_history_idx for every agent's most recent run, so the
 *      roster's status pills cost one query rather than one per agent;
 *   3. `countPendingProposalsByAgent` — ONE tally over
 *      `user_agent_proposals_owner_idx (owner_id, status, created_at desc)` for
 *      every agent's approval badge, bounded by PENDING_PROPOSAL_SCAN_LIMIT. It
 *      is on first paint for the same reason the status pills are: until it
 *      existed, a queued approval was discoverable ONLY by expanding the run
 *      that produced it, so an agent quietly waiting on its owner looked
 *      identical to one with nothing to say;
 *   4. the org's AI settings, for the REAL per-user agent cap AND the
 *      capability ceiling (`agentCapabilityCeiling`) the editor's toggles are
 *      disabled against — one read backs both, never two;
 *   5. the model catalog for the editor's pin — `listEnabledProviders` plus one
 *      `listActiveModels` per enabled provider, each served by
 *      `ai_models_selectable_idx` (tens of rows apiece, never an unbounded
 *      select).
 *
 * Read 5 is on first paint deliberately. Opening the editor, opening the model
 * picker, searching it and switching provider inside it are all in-page state
 * changes over data already in hand — 0 new server round-trips, no `<Link>` and
 * no `router` navigation anywhere in this page's interactions (working
 * agreement #5 / gotcha-09, where a navigation re-ran every query on the page).
 * Fetching the catalog when the editor opens would trade one page-load read for
 * a spinner on every open.
 *
 * The FULL run history is still not part of first paint: `AgentRunHistory`
 * fetches it per agent, only on expand. Last-run status is — it is the failure
 * signal, and a signal nobody expands to see is not a signal.
 *
 * `readOrgAiSettings` throws on a genuine read failure (a missing row is a
 * documented default, not an error). Neither the cap label, a status pill nor
 * the model list is worth 500-ing a page whose primary job is listing agents,
 * so each supporting read degrades on its own: the cap falls back to the
 * shipped default, the pills fall back to absent, and an unreadable catalog
 * leaves the picker on its "add an API key" state with every agent still
 * inheriting the org default.
 */
export default async function AgentsSettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [rosterResult, lastRuns, pendingProposals, orgAiSettings, catalog] =
    await Promise.all([
      supabase
        .from("user_agents")
        .select(
          "id, name, template_id, instructions, board_scope, cadence, run_at_local_hour, enabled, provider, model_id, capabilities, run_on_weekday, run_on_day_of_month",
        )
        .eq("owner_id", user.id)
        .order("created_at", { ascending: true })
        .limit(20),
      getMyAgentLastRuns(supabase).catch(
        (): Record<string, AgentRunLike> => ({}),
      ),
      // ONE tally for the whole roster — an index scan over
      // `(owner_id, status, created_at desc)`, bounded, never a query per agent.
      // Degrades to no badges rather than 500-ing the page, like its neighbours.
      countPendingProposalsByAgent(supabase, user.id).catch(
        (): Record<string, number> => ({}),
      ),
      // One read backs both the per-user agent cap AND the capability ceiling
      // the editor disables toggles against — the same degrade-open posture as
      // before (an org whose settings can't be read falls back to the full
      // shipped default, never a silently locked-down page).
      resolveActiveOrg()
        .then((org) =>
          org ? readOrgAiSettings(supabase, org.id) : DEFAULT_ORG_AI_SETTINGS,
        )
        .catch(() => DEFAULT_ORG_AI_SETTINGS),
      listEnabledProviders(supabase)
        .then(async (providers) => ({
          providers,
          modelOptions: await buildModelOptions(supabase, providers),
        }))
        .catch(
          (): { providers: ProviderRow[]; modelOptions: ModelOption[] } => ({
            providers: [],
            modelOptions: [],
          }),
        ),
    ]);
  const maxAgents = orgAiSettings.maxAgentsPerUser;
  const capabilityCeiling = orgAiSettings.agentCapabilityCeiling;

  const agents: AgentRecord[] = (rosterResult.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    templateId: a.template_id,
    instructions: a.instructions,
    boardScope: a.board_scope as BoardScope,
    cadence: a.cadence as AgentCadence,
    runAtLocalHour: a.run_at_local_hour,
    enabled: a.enabled,
    // The pin, straight through. Both columns are nullable and null on both is
    // "inherit the org default" — the editor renders exactly that state.
    provider: a.provider,
    modelId: a.model_id,
    // The grant set and the cadence day operand. Part of the ROSTER read, not a
    // second query on edit: the editor re-sends the whole row on every save, so
    // an agent whose grants were not loaded would have them revoked by an edit
    // to its name. `capabilities` is `text[]` in the generated types and is
    // narrowed here — `user_agents_capabilities_known` is what enforces it.
    capabilities: a.capabilities as AgentCapability[],
    runOnWeekday: a.run_on_weekday,
    runOnDayOfMonth: a.run_on_day_of_month,
  }));

  return (
    <SettingsSection
      title="Agents"
      description="Scheduled assistants that read your boards and email you what's pending, once a day."
    >
      <div className="pt-4">
        <AgentsSection
          agents={agents}
          lastRuns={lastRuns}
          pendingProposals={pendingProposals}
          maxAgents={maxAgents}
          modelOptions={catalog.modelOptions}
          providers={catalog.providers}
          capabilityCeiling={capabilityCeiling}
        />
      </div>
    </SettingsSection>
  );
}
