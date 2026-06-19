"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createAutomationSchema,
  updateAutomationSchema,
  deleteAutomationSchema,
} from "@/lib/validations/automations";
import { listAutomations, type Automation } from "@/lib/boards/queries";
import type { Json, Tables } from "@/types/database.types";
import { actionsContainWebhook } from "@/lib/boards/automation-action-helpers";

/**
 * Client-callable read wrapper around {@link listAutomations} so the
 * Automations dialog can fetch rules via TanStack Query. RLS scopes the rows
 * to the caller's org; the underlying query is bounded (per board, ordered).
 */
export async function getAutomations(boardId: string): Promise<Automation[]> {
  return listAutomations(boardId);
}

export type AutomationRun = Tables<"automation_runs">;

/**
 * Client-callable read wrapper for automation run history. RLS scopes rows to
 * the caller's org; the query is bounded (limit) and ordered by the indexed
 * created_at desc.
 */
export async function getAutomationRuns(
  automationId: string,
  limit = 50,
): Promise<AutomationRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_runs")
    .select("*")
    .eq("automation_id", automationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

async function isOrgAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.role === "owner" || data?.role === "admin";
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

export async function createAutomation(input: {
  boardId: string;
  name?: string;
  trigger: unknown;
  actions: unknown;
  condition?: unknown;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = createAutomationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: board, error: bErr } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", parsed.data.boardId)
    .maybeSingle();
  if (bErr || !board) return fail("Board not found.");

  if (
    actionsContainWebhook(parsed.data.actions) &&
    !(await isOrgAdmin(supabase, board.org_id))
  ) {
    return fail("Webhook actions require an organization admin");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: nextPos } = await supabase
    .from("automations")
    .select("position")
    .eq("board_id", parsed.data.boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("automations")
    .insert({
      org_id: board.org_id,
      board_id: parsed.data.boardId,
      name: parsed.data.name ?? null,
      trigger: parsed.data.trigger as unknown as Json,
      actions: parsed.data.actions as unknown as Json,
      condition: (parsed.data.condition ?? null) as unknown as Json,
      created_by: user?.id ?? null,
      position: (nextPos?.position ?? -1) + 1,
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Failed to create");

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, data: { id: data.id } };
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
    if (!row || !(await isOrgAdmin(supabase, row.org_id))) {
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
