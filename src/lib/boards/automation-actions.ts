"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  updateAutomationSchema,
  deleteAutomationSchema,
} from "@/lib/validations/automations";
import { listAutomations, type Automation } from "@/lib/boards/queries";
import type { Json, Tables } from "@/types/database.types";
import { actionsContainWebhook } from "@/lib/boards/automation-action-helpers";
import {
  createAutomationCore,
  isOrgAdmin as isOrgAdminCore,
  type CreateAutomationCoreInput,
} from "@/lib/boards/automation-core";
import { fail, type ActionResult } from "@/lib/actions/result";

/**
 * Client-callable read wrapper around {@link listAutomations} so the
 * Automations dialog can fetch rules via TanStack Query. RLS scopes the rows
 * to the caller's org; the underlying query is bounded (per board, ordered).
 */
export async function getAutomations(boardId: string): Promise<Automation[]> {
  return listAutomations(boardId);
}

export type AutomationRun = Tables<"automation_runs">;

/** Clamp the requested page size into [1, 100] — a bad/oversized limit is
 *  coerced rather than rejected so the disclosure always renders something. */
const runsLimitSchema = z
  .number()
  .catch(50)
  .transform((n) => Math.min(100, Math.max(1, Math.trunc(n))));

/**
 * Client-callable read wrapper for automation run history. Returns the shared
 * {@link ActionResult} shape (like every sibling action) so the caller can tell
 * a failed read apart from an empty history. RLS scopes rows to the caller's
 * org; the query is bounded (clamped limit, max 100) and ordered by the indexed
 * created_at desc.
 */
export async function getAutomationRuns(
  automationId: string,
  limit = 50,
): Promise<ActionResult<AutomationRun[]>> {
  const safeLimit = runsLimitSchema.parse(limit);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_runs")
    .select("*")
    .eq("automation_id", automationId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) return fail(error.message);
  return { ok: true, data: data ?? [] };
}

/** Cookie-client wrapper around the core's actor-parameterised check: resolve
 *  the caller from the session, then ask the one implementation. */
async function isOrgAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isOrgAdminCore(supabase, orgId, user?.id ?? null);
}

export async function getBoardAdminStatus(boardId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", boardId)
    .maybeSingle();
  if (!board) return false;
  return isOrgAdmin(supabase, board.org_id);
}

/**
 * Thin cookie-bound wrapper over {@link createAutomationCore}. Every rule —
 * validation, the board lookup, the webhook admin-gate, the position — lives in
 * the core so the agent runtime's `create_automation` tool cannot diverge from
 * this action. Only `revalidatePath` stays here: it needs a request context the
 * core's other caller does not have.
 */
export async function createAutomation(
  input: CreateAutomationCoreInput,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await createAutomationCore(supabase, input, user?.id ?? null);
  if (result.ok) revalidatePath(`/boards/${input.boardId}`);
  return result;
}

export async function updateAutomation(input: {
  id: string;
  name?: string;
  enabled?: boolean;
  trigger?: unknown;
  actions?: unknown;
  condition?: unknown;
}): Promise<ActionResult> {
  const parsed = updateAutomationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  if (
    parsed.data.actions !== undefined &&
    actionsContainWebhook(parsed.data.actions)
  ) {
    const { data: row } = await supabase
      .from("automations")
      .select("org_id")
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (!row) return fail("Automation not found.");
    if (!(await isOrgAdmin(supabase, row.org_id))) {
      return fail("Webhook actions require an organization admin");
    }
  }

  const patch = {
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(parsed.data.enabled !== undefined
      ? { enabled: parsed.data.enabled }
      : {}),
    ...(parsed.data.trigger !== undefined
      ? { trigger: parsed.data.trigger as unknown as Json }
      : {}),
    ...(parsed.data.actions !== undefined
      ? { actions: parsed.data.actions as unknown as Json }
      : {}),
    ...(parsed.data.condition !== undefined
      ? { condition: parsed.data.condition as unknown as Json }
      : {}),
  };

  const { data, error } = await supabase
    .from("automations")
    .update(patch)
    .eq("id", parsed.data.id)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (data?.board_id) revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

export async function deleteAutomation(input: {
  id: string;
}): Promise<ActionResult> {
  const parsed = deleteAutomationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automations")
    .delete()
    .eq("id", parsed.data.id)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (data?.board_id) revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}
