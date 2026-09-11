import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Fan out `kind: "assigned"` notifications to the members newly added to a
 * People cell, excluding the actor. Extracted from `upsertCellCore` so
 * `apply-core.ts`'s `reassign` action can reuse the exact same fan-out
 * (spec §7) without duplicating it.
 *
 * Best-effort: the cell write already succeeded by the time this runs, so it
 * NEVER throws — a missing actor or a failed insert is logged instead (spec
 * F3 / decision D4), the same contract `upsertCellCore` had inline.
 */
export async function notifyNewAssignees(
  supabase: SupabaseClient<Database>,
  args: {
    orgId: string;
    boardId: string;
    itemId: string;
    actorId: string | null;
    prior: readonly string[];
    next: readonly string[];
  },
): Promise<void> {
  const added = args.next.filter(
    (id) => !args.prior.includes(id) && id !== args.actorId,
  );
  if (added.length === 0) return;

  let notifError: string | undefined;
  if (!args.actorId) {
    // A null actor cannot satisfy the `actor_id = auth.uid()` insert policy,
    // so log it instead of paying a round-trip to be told so.
    notifError = "no actor";
  } else {
    const { error: notifErr } = await supabase.from("notifications").insert(
      added.map((rid) => ({
        org_id: args.orgId,
        recipient_id: rid,
        actor_id: args.actorId as string,
        kind: "assigned" as const,
        board_id: args.boardId,
        item_id: args.itemId,
      })),
    );
    notifError = notifErr?.message;
  }
  if (notifError)
    console.error("[notifications] assigned fan-out failed", {
      itemId: args.itemId,
      recipients: added.length,
      error: notifError,
    });
}
