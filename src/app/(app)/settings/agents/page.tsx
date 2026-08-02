import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveOrg } from "@/lib/org/active";
import { SettingsSection } from "@/components/settings/settings-section";
import { AgentsSection } from "@/components/agents/AgentsSection";
import type { AgentRecord } from "@/components/agents/AgentEditor";
import type { AgentCadence, BoardScope } from "@/lib/agents/agent-config";
import { getMyAgentLastRuns } from "@/lib/agents/agents-db";
import {
  readOrgAiSettings,
  DEFAULT_ORG_AI_SETTINGS,
} from "@/lib/ai/org-settings";
import type { AgentRunLike } from "@/lib/agents/run-status";

export const metadata = { title: "Agents · Settings" };

/**
 * Settings → Agents. Server Component.
 *
 * First paint is THREE bounded reads, all indexed, issued concurrently:
 *   1. the roster — `.eq("owner_id", …)` hits the (owner_id, enabled) index
 *      prefix; the select includes `instructions`/`board_scope` alongside the
 *      roster fields so opening the editor for an existing agent is a
 *      client-state transition over data already in hand, not a round trip;
 *   2. `get_my_agent_last_runs()` — one `distinct on` over
 *      user_agent_runs_history_idx for every agent's most recent run, so the
 *      roster's status pills cost one query rather than one per agent;
 *   3. the org's AI settings, for the REAL per-user agent cap.
 *
 * The FULL run history is still not part of first paint (working agreement
 * #5): `AgentRunHistory` fetches it per agent, only on expand. Last-run status
 * is — it is the failure signal, and a signal nobody expands to see is not a
 * signal.
 *
 * `readOrgAiSettings` throws on a genuine read failure (a missing row is a
 * documented default, not an error). Neither the cap label nor a status pill is
 * worth 500-ing a page whose primary job is listing agents, so each of the two
 * supporting reads degrades on its own: the cap falls back to the shipped
 * default and the pills fall back to absent.
 */
export default async function AgentsSettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [rosterResult, lastRuns, maxAgents] = await Promise.all([
    supabase
      .from("user_agents")
      .select(
        "id, name, template_id, instructions, board_scope, cadence, run_at_local_hour, enabled",
      )
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true })
      .limit(20),
    getMyAgentLastRuns(supabase).catch(
      (): Record<string, AgentRunLike> => ({}),
    ),
    resolveActiveOrg()
      .then((org) =>
        org ? readOrgAiSettings(supabase, org.id) : DEFAULT_ORG_AI_SETTINGS,
      )
      .then((s) => s.maxAgentsPerUser)
      .catch(() => DEFAULT_ORG_AI_SETTINGS.maxAgentsPerUser),
  ]);

  const agents: AgentRecord[] = (rosterResult.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    templateId: a.template_id,
    instructions: a.instructions,
    boardScope: a.board_scope as BoardScope,
    cadence: a.cadence as AgentCadence,
    runAtLocalHour: a.run_at_local_hour,
    enabled: a.enabled,
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
          maxAgents={maxAgents}
        />
      </div>
    </SettingsSection>
  );
}
