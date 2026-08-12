import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { actionsContainWebhook } from "@/lib/boards/automation-action-helpers";
import { createAutomationSchema } from "@/lib/validations/automations";
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
 * adds the `revalidatePath` a request context allows) and
 * `createAutomationDescriptor` (`@/lib/agents/create-automation-tool`).
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
