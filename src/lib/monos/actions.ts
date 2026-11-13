"use server";

import { randomUUID } from "node:crypto";
import { updateTag } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { orgMembersTag } from "@/lib/cache/tags";
import { fail, type ActionResult } from "@/lib/actions/result";
import { boardIdInputSchema, monoInputSchema } from "@/lib/validations/monos";
import { getMyMono } from "./queries";
import { monoEmail, type MyMono } from "./types";

const CREATE_FAILED = "Couldn't create your Mono. Please try again.";

/**
 * Create the caller's Mono in the active org, idempotently.
 *
 * Order matters (Plan 2A decision D1): the bot is created with the GoTrue
 * admin API first (confirmed, pre-approved, internal email), then the
 * service-role-only `create_mono` RPC adds the Mono row, flags the profile and
 * adds the `agent` membership. The owner id is the SESSION user's, never
 * input. A bot left unused (a lost race, a refused RPC) is deleted.
 * `requireUser()` stays outside the try: its redirect is a thrown sentinel.
 */
export async function createMyMono(input: {
  name: string;
  color: string;
}): Promise<ActionResult<MyMono>> {
  const parsed = monoInputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid Mono.");
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");

  // Set once the bot user exists; cleared only when `create_mono` adopts it.
  // Anything else (a lost race, a refusal, a throw) deletes it in `finally`.
  let orphanBotId: string | null = null;
  let svc: ReturnType<typeof createServiceClient> | null = null;
  try {
    const supabase = await createClient();
    const existing = await getMyMono(supabase, org.id);
    if (existing) return { ok: true, data: existing };

    svc = createServiceClient();
    const monoId = randomUUID();
    const { error: createErr } = await svc.auth.admin.createUser({
      id: monoId,
      email: monoEmail(monoId),
      email_confirm: true,
      app_metadata: { pre_approved: true, mono: true },
      user_metadata: { full_name: parsed.data.name },
    });
    if (createErr) {
      console.error("[mono] bot user create failed", createErr.message);
      return fail(CREATE_FAILED);
    }
    orphanBotId = monoId;

    const { data: winner, error: rpcErr } = await svc.rpc("create_mono", {
      p_org_id: org.id,
      p_owner_id: user.id,
      p_mono_id: monoId,
      p_name: parsed.data.name,
      p_color: parsed.data.color,
    });
    if (rpcErr) {
      console.error("[mono] create_mono refused", rpcErr.message);
      return fail(CREATE_FAILED);
    }
    // Our bot is now the Mono; a different id means another tab won the
    // race, so ours stays marked for deletion and the winner is returned.
    if (winner === monoId) orphanBotId = null;

    updateTag(orgMembersTag(org.id));
    const mono = await getMyMono(supabase, org.id);
    return mono ? { ok: true, data: mono } : fail(CREATE_FAILED);
  } catch (e) {
    console.error("[mono] createMyMono failed", e);
    return fail(CREATE_FAILED);
  } finally {
    if (svc && orphanBotId) await deleteOrphanBot(svc, orphanBotId);
  }
}

/** Best-effort delete of an unused Mono bot user; logs (never throws) on failure. */
async function deleteOrphanBot(
  svc: ReturnType<typeof createServiceClient>,
  botId: string,
): Promise<void> {
  try {
    const { error } = await svc.auth.admin.deleteUser(botId);
    if (error)
      console.error("[mono] orphan bot cleanup failed", {
        botId,
        message: error.message,
      });
  } catch (e) {
    console.error("[mono] orphan bot cleanup failed", {
      botId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Rename and recolour the caller's Mono (owner-scoped RPC). */
export async function updateMyMono(input: {
  name: string;
  color: string;
}): Promise<ActionResult<MyMono>> {
  const parsed = monoInputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid Mono.");
  await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_my_mono", {
      p_org_id: org.id,
      p_name: parsed.data.name,
      p_color: parsed.data.color,
    });
    if (error) return fail("Couldn't save your Mono.");
    updateTag(orgMembersTag(org.id));
    const mono = await getMyMono(supabase, org.id);
    return mono ? { ok: true, data: mono } : fail("Couldn't save your Mono.");
  } catch (e) {
    console.error("[mono] updateMyMono failed", e);
    return fail("Couldn't save your Mono.");
  }
}

function boardRefusal(code: string | undefined): string {
  return code === "42501"
    ? "You can only add your Mono to boards you can open."
    : code === "P0002"
      ? "That board or your Mono could not be found."
      : "Couldn't change your Mono's boards. Please try again.";
}

/** Put the caller's Mono on a board the caller can open (owner's level). */
export async function addMyMonoToBoard(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = boardIdInputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid board.");
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_my_mono_to_board", {
    p_board_id: parsed.data.boardId,
  });
  if (error) return fail(boardRefusal(error.code));
  return { ok: true, data: undefined };
}

/** Take the caller's Mono off a board. */
export async function removeMyMonoFromBoard(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = boardIdInputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid board.");
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_my_mono_from_board", {
    p_board_id: parsed.data.boardId,
  });
  if (error) return fail(boardRefusal(error.code));
  return { ok: true, data: undefined };
}
