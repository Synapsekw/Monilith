import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { actionsContainWebhook } from "@/lib/boards/automation-action-helpers";
import {
  createAutomationSchema,
  updateAutomationSchema,
  deleteAutomationSchema,
} from "@/lib/validations/automations";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { Database, Json } from "@/types/database.types";

/** What creating an automation needs, still unparsed — the core owns the Zod
 *  boundary so both callers validate identically. */
export type CreateAutomationCoreInput = {
  boardId: string;
  name?: string;
  trigger: unknown;
  actions: unknown;
  condition?: unknown;
};

/** What updating an automation needs, still unparsed. */
export type UpdateAutomationCoreInput = {
  id: string;
  name?: string;
  enabled?: boolean;
  trigger?: unknown;
  actions?: unknown;
  condition?: unknown;
};

/** What deleting an automation needs. */
export type DeleteAutomationCoreInput = { id: string };

/**
 * True when `actorId` is an owner/admin of `orgId`.
 *
 * Takes the actor as a parameter rather than reading `supabase.auth.getUser()`:
 * a bridged (bearer-token) client would pay a GoTrue round-trip per check and
 * the lookup depends on supabase-js's custom-Authorization-header internals.
 * A null actor is not an admin — the same answer the auth-reading version gave
 * when there was no user.
 */
export async function isOrgAdmin(
  supabase: SupabaseClient<Database>,
  orgId: string,
  actorId: string | null,
): Promise<boolean> {
  if (!actorId) return false;
  const { data } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", actorId)
    .maybeSingle();
  return data?.role === "owner" || data?.role === "admin";
}

/**
 * The single implementation of "create one automation rule" for the whole app:
 * validates the input, resolves the board's org, enforces the webhook
 * admin-gate, and inserts at the end of the board's rule order.
 *
 * Both the Supabase client AND the actor are injected, which is the entire
 * point: the cookie-bound `createAutomation` Server Action and an agent run
 * holding only an owner-bridged client must produce identical side effects —
 * INCLUDING the guard that webhook actions require an org admin. Re-implementing
 * instead of extracting is exactly how the `people` assignment fan-out was
 * silently dropped from the MCP path
 * (`vault/decisions/2026-07-25-gotcha-60-server-action-side-effects-invisible-to-mcp.md`);
 * this function therefore never calls `supabase.auth.*` and never touches
 * `next/cache`, so both transports can reach it.
 *
 * Callers: `createAutomation` (`./automation-actions.ts`, cookie client, which
 * adds the `revalidatePath` a request context allows) and the `create` branch
 * of `manageAutomationDescriptor` (`@/lib/agents/manage-automation-tool`).
 */
export async function createAutomationCore(
  supabase: SupabaseClient<Database>,
  input: CreateAutomationCoreInput,
  actorId: string | null,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createAutomationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const { data: board, error: bErr } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", parsed.data.boardId)
    .maybeSingle();
  if (bErr || !board) return fail("Board not found.");

  // Irreversible egress: admin-only, on every path that can create a rule.
  if (
    actionsContainWebhook(parsed.data.actions) &&
    !(await isOrgAdmin(supabase, board.org_id, actorId))
  ) {
    return fail("Webhook actions require an organization admin");
  }

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
      created_by: actorId,
      position: (nextPos?.position ?? -1) + 1,
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Failed to create");

  return { ok: true, data: { id: data.id } };
}

/**
 * The single implementation of "update one automation rule", beside
 * {@link createAutomationCore} for the same reason: the `updateAutomation`
 * Server Action (`./automation-actions.ts`, which adds the `revalidatePath` a
 * request context allows) and the agent-only `manage_automation` tool
 * (`@/lib/agents/manage-automation-tool`) must produce identical side effects.
 *
 * KEEPS the `actionsContainWebhook` guard: an agent editing an existing
 * automation to ADD a webhook action is exactly the case that guard exists
 * for, so dropping it here — the one place both callers actually run the
 * patch — would be a real security regression, not a simplification. Like
 * `createAutomationCore`, the actor is injected rather than read from
 * `supabase.auth` so a bridged (bearer-token) client is not charged a GoTrue
 * round-trip per check.
 */
export async function updateAutomationCore(
  supabase: SupabaseClient<Database>,
  input: UpdateAutomationCoreInput,
  actorId: string | null,
): Promise<ActionResult<{ boardId: string | null }>> {
  const parsed = updateAutomationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

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
    if (!(await isOrgAdmin(supabase, row.org_id, actorId))) {
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

  return { ok: true, data: { boardId: data?.board_id ?? null } };
}

/**
 * The single implementation of "delete one automation rule". No admin gate:
 * deleting a rule (unlike adding a webhook to one) was never gated for a
 * human, so this stays a plain org-scoped delete — RLS is the boundary.
 */
export async function deleteAutomationCore(
  supabase: SupabaseClient<Database>,
  input: DeleteAutomationCoreInput,
): Promise<ActionResult<{ boardId: string | null }>> {
  const parsed = deleteAutomationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const { data, error } = await supabase
    .from("automations")
    .delete()
    .eq("id", parsed.data.id)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);

  return { ok: true, data: { boardId: data?.board_id ?? null } };
}
