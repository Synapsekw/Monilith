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
  unpinnedDefaultModel,
  DEFAULT_ORG_AI_SETTINGS,
} from "@/lib/ai/org-settings";
import { listEnabledProviders } from "@/lib/ai/providers/provider-rows";
import { buildModelOptions } from "@/lib/ai/models/model-options";
import type { ModelOption } from "@/components/settings/ModelPicker";
import type { ProviderRow } from "@/lib/ai/providers/provider-rows";
import type { AgentRunLike } from "@/lib/agents/run-status";
import {
  listDocumentsForOwner,
  listAttachmentsByAgent,
} from "@/lib/agents/documents-db";

export const metadata = { title: "Agents · Settings" };

/**
 * Settings → Agents. Server Component.
 *
 * First paint is SEVEN bounded reads, all indexed, issued concurrently:
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
 *      select);
 *   6. the reference-document library — `listDocumentsForOwner` selects
 *      METADATA ONLY, never `body` (documents can run to 2,000,000 characters;
 *      shipping every body just to render a list of titles would be its own
 *      gotcha-09), bounded by `LIBRARY_PAGE_SIZE` over the
 *      `agent_documents_owner_idx (owner_id, updated_at desc)` index;
 *   7. `listAttachmentsByAgent` — one query for the WHOLE roster's attachment
 *      sets, keyed by agent id (`user_agent_id -> document_id[]`), joined
 *      through `user_agent_documents.user_agents!inner(owner_id)` since the
 *      join table itself carries no owner column. `AgentsSection` inverts this
 *      into document id -> agent NAMES using the roster it already has, so the
 *      library's delete confirmation can name the agents a document would
 *      stop feeding — no per-document query.
 *
 * Reads 5-7 are on first paint deliberately. Opening the editor, opening the model
 * picker, searching it and switching provider inside it — and now, switching to
 * the "Reference documents" view, opening its add-document form, and its live
 * token count as the owner types — are all in-page state changes over data
 * already in hand — 0 new server round-trips, no `<Link>` and no `router`
 * navigation anywhere in this page's interactions (working agreement #5 /
 * gotcha-09, where a navigation re-ran every query on the page). Fetching the
 * catalog when the editor opens, or the library when its view opens, would
 * trade one page-load read for a spinner on every open.
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

  const [
    rosterResult,
    lastRuns,
    pendingProposals,
    orgAiSettings,
    catalog,
    documentPage,
    attachmentsByAgent,
  ] = await Promise.all([
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
      .catch((): { providers: ProviderRow[]; modelOptions: ModelOption[] } => ({
        providers: [],
        modelOptions: [],
      })),
    // Metadata only — see read 6 above. Degrades to an empty library rather
    // than 500-ing the page, like every other supporting read here.
    listDocumentsForOwner(supabase, user.id).catch(
      (): Awaited<ReturnType<typeof listDocumentsForOwner>> => ({
        rows: [],
        total: 0,
      }),
    ),
    // See read 7 above. Degrades to "nothing attached anywhere", which only
    // costs the delete confirmation its agent names — never a 500.
    listAttachmentsByAgent(supabase, user.id).catch(
      (): Record<string, string[]> => ({}),
    ),
  ]);
  const maxAgents = orgAiSettings.maxAgentsPerUser;
  const capabilityCeiling = orgAiSettings.agentCapabilityCeiling;
  // The context length an UNPINNED agent's meter must budget against — the
  // run loop's own `pickModel` resolves both "never pinned" and "pinned at a
  // since-retired model" (excluded from `active`, hence absent from
  // `catalog.modelOptions` too) to this SAME org default before falling
  // further to a tier default. Both catalog reads that back it
  // (`readOrgAiSettings`, `buildModelOptions`) are already in this
  // `Promise.all` for other reasons — this is a lookup over data already in
  // hand, not a new read.
  //
  // It goes through `unpinnedDefaultModel`, NEVER through
  // `defaultProvider`/`defaultModelId` directly: the gateway honours the
  // default model only when its provider matches the one the MODE resolves,
  // and an org may legally sit in `managed` mode with an OpenAI default. Read
  // straight, that configuration would size the meter against a 1M-token
  // OpenAI window, accept a 200k document set, and then watch the run resolve
  // an Anthropic 200k default and drop every document — the exact silent
  // failure this meter exists to prevent.
  //
  // Null when the org has no usable default (none set, provider mismatch, or
  // a model the catalog no longer has): the run's eventual fallback then
  // depends on the feature's tier, which this page has no way to predict, so
  // the picker falls back to NULL_CONTEXT_FALLBACK and SAYS SO rather than
  // guessing.
  const unpinnedDefault = unpinnedDefaultModel(orgAiSettings);
  const orgDefaultContextLength = unpinnedDefault
    ? (catalog.modelOptions.find(
        (m) =>
          m.provider === unpinnedDefault.provider &&
          m.modelId === unpinnedDefault.modelId,
      )?.contextLength ?? null)
    : null;

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
          documents={documentPage.rows}
          documentTotal={documentPage.total}
          attachmentsByAgent={attachmentsByAgent}
          orgDefaultContextLength={orgDefaultContextLength}
        />
      </div>
    </SettingsSection>
  );
}
