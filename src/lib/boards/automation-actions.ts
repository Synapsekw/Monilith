"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createAutomationSchema,
  updateAutomationSchema,
  deleteAutomationSchema,
} from "@/lib/validations/automations";
import { listAutomations, type Automation } from "@/lib/boards/queries";
import type { Json } from "@/types/database.types";

/**
 * Client-callable read wrapper around {@link listAutomations} so the
 * Automations dialog can fetch rules via TanStack Query. RLS scopes the rows
 * to the caller's org; the underlying query is bounded (per board, ordered).
 */
export async function getAutomations(boardId: string): Promise<Automation[]> {
  return listAutomations(boardId);
}

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

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
