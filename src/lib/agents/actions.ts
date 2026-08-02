"use server";

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

const SETTINGS_PATH = "/settings/agents";
const NO_ORG = "No organization.";

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
      template_id: s.templateId,
      instructions: s.instructions,
      board_scope: s.boardScope,
      cadence: s.cadence,
      run_at_local_hour: s.runAtLocalHour,
      enabled: s.enabled,
    } as never)
    .select("id")
    .single();

  if (error || !data) return fail("Couldn't create that agent.");
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
      template_id: s.templateId,
      instructions: s.instructions,
      board_scope: s.boardScope,
      cadence: s.cadence,
      run_at_local_hour: s.runAtLocalHour,
      enabled: s.enabled,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) return fail("Couldn't save that agent.");
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
  const { error } = await supabase
    .from("user_agents")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return fail("Couldn't delete that agent.");
  revalidatePath(SETTINGS_PATH);
  return { ok: true, data: undefined };
}
