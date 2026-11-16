import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { Database, Json } from "@/types/database.types";
import type { AddUpdateInput } from "@/lib/validations/collaboration-actions";
import { keepOwnMonoMentions } from "@/lib/collaboration/mentions";

/**
 * The single implementation of "post an update (comment) on an item": derives
 * org/board from the item under RLS, applies the Mono mention rule, inserts
 * the `item_updates` row and fans out one notification per mentioned person.
 *
 * The client AND the actor are injected, exactly like `upsertCellCore` and
 * `createAttachmentCore`: the `addUpdate` Server Action (cookie session) and
 * the `add_comment` tool (MCP bearer token, or the assistant's confirmed
 * batch) reach this with different clients but must produce identical side
 * effects. It therefore never calls `supabase.auth.*`. RLS on `item_updates`
 * and `notifications` is the permission check on every path.
 *
 * `input` is already parsed by the caller's `addUpdateSchema` boundary.
 */
export async function addUpdateCore(
  supabase: SupabaseClient<Database>,
  input: AddUpdateInput,
  actorId: string,
): Promise<ActionResult<{ updateId: string }>> {
  // org_id/board_id are denormalized — derive them from the item (RLS-scoped).
  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("org_id, board_id")
    .eq("id", input.itemId)
    .maybeSingle();
  if (itemErr || !item) return fail("Item not found.");

  // Mentions vs Monos (Personal Monos spec §4). One bounded read (≤20 ids on
  // the monos PK, org-scoped by RLS and the filter) tells which mentioned ids
  // are Monos: a Mono is never stored as a user mention (no notification, no
  // Plan 2B ambiguity), and only the author's own Mono is kept as a Mono
  // mention. Skipped entirely when nothing is mentioned. A failed read keeps
  // no Mono mention (fails closed).
  let mentions = input.mentions;
  if (mentions.length > 0) {
    const { data: monoRows } = await supabase
      .from("monos")
      .select("user_id, owner_id")
      .eq("org_id", item.org_id)
      .in("user_id", [...new Set(mentions.map((m) => m.userId))]);
    const rows = monoRows ?? [];
    const monoIds = new Set(rows.map((r) => r.user_id));
    mentions = keepOwnMonoMentions(
      mentions.filter((m) => !(m.kind === "user" && monoIds.has(m.userId))),
      rows.filter((r) => r.owner_id === actorId).map((r) => r.user_id),
    );
  }

  const { data, error } = await supabase
    .from("item_updates")
    .insert({
      org_id: item.org_id,
      board_id: item.board_id,
      item_id: input.itemId,
      author_id: actorId,
      body: { text: input.text, mentions } as Json,
      body_text: input.text,
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not post update.");

  // Fan out one notification per mentioned member (deduped, excluding self).
  // Humans only: a non-user target has no `profiles` row, so a notification
  // row for one would be undeliverable.
  const recipients = [
    ...new Set(mentions.filter((m) => m.kind === "user").map((m) => m.userId)),
  ].filter((id) => id !== actorId);
  if (recipients.length > 0) {
    const { error: notifErr } = await supabase.from("notifications").insert(
      recipients.map((rid) => ({
        org_id: item.org_id,
        recipient_id: rid,
        actor_id: actorId,
        kind: "mention" as const,
        board_id: item.board_id,
        item_id: input.itemId,
        update_id: data.id,
      })),
    );
    // Best-effort fan-out: the update already posted (spec F3 / decision D4).
    if (notifErr)
      console.error("[notifications] mention fan-out failed", {
        itemId: input.itemId,
        recipients: recipients.length,
        error: notifErr.message,
      });
  }

  return { ok: true, data: { updateId: data.id } };
}
