"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { type ActionResult, fail } from "@/lib/actions/result";
import {
  personalAgentSettingsSchema,
  type PersonalAgentSettings,
} from "./agent-config";
import { assertCanCreateAgent, AgentCapExceededError } from "./caps";
import { listAgentRuns, RUN_HISTORY_LIMIT } from "./agents-db";
import type { AgentRunSummary } from "./run-status";

const SETTINGS_PATH = "/settings/agents";
const NO_ORG = "No organization.";

/**
 * Turn a unique-violation into the field message it is actually about.
 *
 * Uniqueness of both the handle and the display name is enforced by INDEXES
 * (`user_agents_owner_handle_uniq`, `user_agents_org_owner_name_uniq`), never
 * by the editor: the only way for the client to pre-empt a collision would be
 * to read every other agent's handle, which is a query the editor must not
 * make on every keystroke. So the database is allowed to be the one that says
 * no — but "Couldn't save that agent" for a taken handle sends the owner
 * looking for a bug instead of typing a different word.
 *
 * Returns null for anything that is not a 23505, so a genuine failure still
 * falls through to the generic message rather than being explained away as a
 * duplicate. The raw driver text is read but never echoed (it names indexes
 * and column values).
 */
function duplicateFieldMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  if (e.code !== "23505") return null;
  const text = `${String(e.message ?? "")} ${String(e.details ?? "")}`;
  if (text.includes("handle")) {
    return "You already have an agent with that handle.";
  }
  if (text.includes("name")) {
    return "You already have an agent with that name.";
  }
  // A 23505 from an index this code does not know about. Naming the wrong
  // field would be worse than naming neither.
  return "You already have an agent with that name or handle.";
}

/**
 * Roster mutations. RLS is the real boundary — every statement here runs on the
 * request-scoped client, so a user can only ever touch their own agents; the
 * explicit owner filters keep the reads on the owner index and make intent
 * obvious at the call site.
 *
 * `requireUser()` only carries the verified JWT claims subset (id/email/
 * metadata) — it does NOT return an orgId. The active org is resolved the same
 * way the neighbouring `src/lib/ai/settings-actions.ts` does it, via
 * `resolveActiveOrg()`.
 */
export async function createAgent(
  input: PersonalAgentSettings,
): Promise<ActionResult<{ id: string }>> {
  const parsed = personalAgentSettingsSchema.safeParse(input);
  if (!parsed.success) return fail("Those agent settings aren't valid.");

  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return fail(NO_ORG);
  const supabase = await createClient();

  try {
    await assertCanCreateAgent(supabase, org.id, user.id);
  } catch (e) {
    if (e instanceof AgentCapExceededError || e instanceof Error) {
      return fail(e.message);
    }
    throw e;
  }

  const s = parsed.data;
  const { data, error } = await supabase
    .from("user_agents")
    .insert({
      org_id: org.id,
      owner_id: user.id,
      name: s.name,
      // The typeable address. In `authenticated`'s column-level INSERT grant
      // since 20260905045108; without it the row falls back to the column
      // default (`agent-<8 hex>`) and the handle the owner typed is lost.
      handle: s.handle,
      template_id: s.templateId,
      instructions: s.instructions,
      board_scope: s.boardScope,
      cadence: s.cadence,
      run_at_local_hour: s.runAtLocalHour,
      enabled: s.enabled,
      // The per-agent model pin, written explicitly as null when unset: the
      // columns are nullable and null is what "inherit the org default" means
      // to the run endpoint. Both were added to `authenticated`'s column-level
      // INSERT grant by 20260810173752 — a column-scoped grant does not extend
      // to columns added later, so naming one outside that list is a hard
      // Postgres failure rather than a silent no-op.
      provider: s.provider,
      model_id: s.modelId,
      // The grant set and the cadence day operand. Written explicitly — an
      // empty grant set stated is not the same as one left to a column default,
      // and this is the one field on the row where "what did we actually mean"
      // has to be answerable from the insert. All three were added to
      // `authenticated`'s column-level INSERT grant by 20260812060142; that
      // table has NO table-level INSERT for `authenticated`, so a column
      // outside the grant list is a hard Postgres failure, not a silent no-op.
      capabilities: s.capabilities,
      run_on_weekday: s.runOnWeekday,
      run_on_day_of_month: s.runOnDayOfMonth,
    } as never)
    .select("id")
    .single();

  if (error || !data) {
    return fail(duplicateFieldMessage(error) ?? "Couldn't create that agent.");
  }
  revalidatePath(SETTINGS_PATH);
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export async function updateAgent(
  id: string,
  input: PersonalAgentSettings,
): Promise<ActionResult> {
  const parsed = personalAgentSettingsSchema.safeParse(input);
  if (!parsed.success) return fail("Those agent settings aren't valid.");

  const user = await requireUser();
  const supabase = await createClient();
  const s = parsed.data;

  const { error } = await supabase
    .from("user_agents")
    .update({
      name: s.name,
      // Always written, like every other field here: a rename that could not
      // re-address the agent would make the editor's handle field a control
      // that silently does nothing.
      handle: s.handle,
      template_id: s.templateId,
      instructions: s.instructions,
      board_scope: s.boardScope,
      cadence: s.cadence,
      run_at_local_hour: s.runAtLocalHour,
      enabled: s.enabled,
      // Always written, both halves — clearing the pin back to null is how an
      // owner returns the agent to the org default, so omitting the columns
      // when unset would make "Use the organization's default" a no-op that
      // silently keeps the old pin.
      provider: s.provider,
      model_id: s.modelId,
      // Always written, all three — revoking a capability and stepping a weekly
      // agent back to daily are both expressed as a SMALLER value, so omitting
      // the columns when they empty out would make revocation a silent no-op.
      // Stale day fields are worse than stale: `user_agents_cadence_fields`
      // rejects a daily row that still carries a weekday, so the whole save
      // would fail on a constraint the user never chose.
      capabilities: s.capabilities,
      run_on_weekday: s.runOnWeekday,
      run_on_day_of_month: s.runOnDayOfMonth,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) {
    return fail(duplicateFieldMessage(error) ?? "Couldn't save that agent.");
  }
  revalidatePath(SETTINGS_PATH);
  return { ok: true, data: undefined };
}

export async function setAgentEnabled(
  id: string,
  enabled: boolean,
): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_agents")
    .update({ enabled, updated_at: new Date().toISOString() } as never)
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return fail("Couldn't change that agent.");
  revalidatePath(SETTINGS_PATH);
  return { ok: true, data: undefined };
}

export async function deleteAgent(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createClient();

  // The editor hides Delete for a built-in agent; THIS is the boundary that
  // holds. Owner-scoped like every other statement in this module, so another
  // person's row can neither be probed nor deleted.
  const { data: row } = await supabase
    .from("user_agents")
    .select("kind")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if ((row as { kind?: string } | null)?.kind === "builtin") {
    // Rename it, switch it off, strip its grants — but it cannot be removed:
    // the seed trigger would recreate it on the next org join, and a user with
    // no orchestrator has no way to get one back.
    return fail(
      "Your built-in assistant can't be deleted. Switch it off instead.",
    );
  }

  const { error } = await supabase
    .from("user_agents")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return fail("Couldn't delete that agent.");
  revalidatePath(SETTINGS_PATH);
  return { ok: true, data: undefined };
}

/** Clamp a requested page size into [1, RUN_HISTORY_LIMIT]. A bad or oversized
 *  limit is coerced rather than rejected, so the disclosure always renders
 *  something — same treatment as `getAutomationRuns`'s `runsLimitSchema`. */
const runsLimitSchema = z
  .number()
  .catch(RUN_HISTORY_LIMIT)
  .transform((n) => Math.min(RUN_HISTORY_LIMIT, Math.max(1, Math.trunc(n))));

/**
 * Client-callable READ (the only one in this module) for one agent's run
 * history — the surface that makes a failing agent visible at all. Deliberately
 * not part of first paint: the roster renders from its own bounded query and
 * this fires only when a row is expanded (working agreement #5).
 *
 * Returns the shared `ActionResult` shape so the caller can tell a failed read
 * apart from an empty history — an agent that has never run and an agent whose
 * history won't load must not look identical.
 *
 * `.eq("owner_id", …)` is NOT stacked on top of the agent filter: RLS
 * (`user_agent_runs_owner_read`) already scopes the table to the caller, so
 * another person's agent id yields an empty list rather than their runs.
 */
export async function getAgentRuns(
  agentId: string,
  limit: number = RUN_HISTORY_LIMIT,
): Promise<ActionResult<AgentRunSummary[]>> {
  if (!z.string().uuid().safeParse(agentId).success) {
    return fail("That agent doesn't exist.");
  }
  await requireUser();
  const supabase = await createClient();
  try {
    return {
      ok: true,
      data: await listAgentRuns(
        supabase,
        agentId,
        runsLimitSchema.parse(limit),
      ),
    };
  } catch (e) {
    // Logged, not just swallowed: this is the ONE read that makes a failing
    // agent visible, so a query that throws here has to leave a trace on the
    // server too — otherwise the only evidence anything went wrong is a red
    // line in one user's browser that nobody is watching.
    console.error(`[agents] run history read failed for ${agentId}`, e);
    return fail("Couldn't load this agent's runs.");
  }
}
