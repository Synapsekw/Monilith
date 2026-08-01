import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { SettingsSection } from "@/components/settings/settings-section";
import { AgentsSection } from "@/components/agents/AgentsSection";
import type { AgentRecord } from "@/components/agents/AgentEditor";
import type { AgentCadence, BoardScope } from "@/lib/agents/agent-config";

export const metadata = { title: "Agents · Settings" };

/**
 * Settings → Agents. Server Component: the roster is ONE bounded query over
 * the (owner_id, enabled) index — `.eq("owner_id", …)` hits the index prefix,
 * `.limit(20)` matches the per-owner agent cap enforced server-side
 * (`assertCanCreateAgent`). The select includes `instructions`/`board_scope`
 * alongside the roster fields so opening the editor for an existing agent is
 * a client-state transition over data already in hand — no extra round trip.
 *
 * Run history is deliberately NOT part of first paint (working agreement #5)
 * — `AgentRoster` renders `lastRunStatus: null` for every row here; a future
 * expand-to-load-history affordance streams that behind its own `<Suspense>`.
 */
export default async function AgentsSettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("user_agents")
    .select(
      "id, name, template_id, instructions, board_scope, cadence, run_at_local_hour, enabled",
    )
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(20);

  const agents: AgentRecord[] = (data ?? []).map((a) => ({
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
        <AgentsSection agents={agents} />
      </div>
    </SettingsSection>
  );
}
