import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";
import { midpoint } from "@/lib/boards/position";

/**
 * The item-lifecycle core: the shared implementation behind both the
 * `addSubitem` / `archiveItem` / `restoreItem` / `reorderItem` / `moveItem`
 * Server Actions (cookie-bound client) and the `manage_item` MCP tool
 * (bridged OAuth client). Each function is the exact body those actions used
 * to run inline, with the Supabase client injected rather than created —
 * every message and RPC call kept verbatim so behavior does not drift between
 * the two transports.
 *
 * `deleteItem` and `purgeItem` are deliberately NOT here: no MCP tool exposes
 * permanent deletion, so those two stay as Server-Action-only bodies in
 * `src/lib/boards/actions/item.ts`. Spec §5.
 */

type Client = SupabaseClient<Database>;

/** Create a subitem under a top-level parent. Derives org/board/group from the
 *  parent (RLS-scoped); the DB trigger enforces the single-level invariant. */
export async function addSubitemCore(
  supabase: Client,
  input: { parentId: string; name: string },
): Promise<ActionResult<{ item: Tables<"items"> }>> {
  const { data: parent, error: parentErr } = await supabase
    .from("items")
    .select("org_id, board_id, group_id, parent_id")
    .eq("id", input.parentId)
    .maybeSingle();
  if (parentErr || !parent) return fail("Parent item not found.");
  if (parent.parent_id !== null) return fail("Subitems cannot be nested.");

  const { data: last } = await supabase
    .from("items")
    .select("position")
    .eq("parent_id", input.parentId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("items")
    .insert({
      org_id: parent.org_id,
      board_id: parent.board_id,
      group_id: parent.group_id,
      parent_id: input.parentId,
      name: input.name,
      position: midpoint(last?.position ?? null, null),
    })
    .select("*")
    .single();
  if (error || !data)
    return fail(error?.message ?? "Could not create subitem.");

  return { ok: true, data: { item: data } };
}

/** Archive an item (+ its live subitems) via the cascade RPC. Reversible. */
export async function archiveItemCore(
  supabase: Client,
  input: { itemId: string },
): Promise<ActionResult> {
  const { error } = await supabase.rpc("archive_item", {
    p_item_id: input.itemId,
  });
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

/** Restore an item archived in the same batch (matching timestamp) via RPC. */
export async function restoreItemCore(
  supabase: Client,
  input: { itemId: string },
): Promise<ActionResult> {
  const { error } = await supabase.rpc("restore_item", {
    p_item_id: input.itemId,
  });
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

/** Update an item's position (subitem reorder within a parent). */
export async function reorderItemCore(
  supabase: Client,
  input: { itemId: string; position: number },
): Promise<ActionResult> {
  const { data, error } = await supabase
    .from("items")
    .update({ position: input.position })
    .eq("id", input.itemId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Item not found.");
  return { ok: true, data: undefined };
}

/**
 * Move a top-level item to a different group on the same board. When
 * `position` is given (drag-drop exact spot), places the item there;
 * otherwise appends it to the end of the target group (position = after the
 * current last top-level row). Drags its subitems' denormalized `group_id`
 * along so they stay under the parent. RLS scopes every read/write to the
 * caller's org; the explicit same-board + top-level guards give a real answer
 * instead of an RLS-filtered silent no-op (mirrors deleteItem's
 * defense-in-depth).
 */
export async function moveItemCore(
  supabase: Client,
  input: { itemId: string; groupId: string; position?: number },
): Promise<ActionResult<{ item: Tables<"items">; subitemIds: string[] }>> {
  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("board_id, parent_id")
    .eq("id", input.itemId)
    .maybeSingle();
  if (itemErr || !item) return fail("Item not found.");
  if (item.parent_id !== null)
    return fail("Subitems can't be moved between groups.");

  const { data: group, error: groupErr } = await supabase
    .from("groups")
    .select("board_id")
    .eq("id", input.groupId)
    .maybeSingle();
  if (groupErr || !group) return fail("Group not found.");
  if (group.board_id !== item.board_id)
    return fail("Group belongs to a different board.");

  // Explicit position (drag-drop exact spot) wins; otherwise append after the
  // target group's last top-level item (bulk move / collapsed-group drop).
  let position = input.position;
  if (position === undefined) {
    const { data: last } = await supabase
      .from("items")
      .select("position")
      .eq("group_id", input.groupId)
      .is("parent_id", null)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    position = midpoint(last?.position ?? null, null);
  }

  const { data: moved, error } = await supabase
    .from("items")
    .update({ group_id: input.groupId, position })
    .eq("id", input.itemId)
    // The whole row, not just the id: PostgREST returns it in the SAME request,
    // so the caller can patch a mounted board without a refetch (gotcha-13).
    .select("*")
    .maybeSingle();
  if (error) return fail(error.message);
  // A viewer can READ the board (both guards above pass) but not write it: the
  // UPDATE then matches zero rows and returns null data with NO error. Read the
  // row back so that silent no-op can't be reported as a successful move —
  // same treatment renameItem gives its own RLS-hidden case.
  if (!moved) return fail("You don't have permission to move this item.");

  // Keep subitems co-located with their parent (their denormalized group_id
  // must match). RLS-scoped; best-effort — the parent already moved. The
  // returned ids let the caller patch a mounted board without a refetch; a
  // failure here costs the caller nothing beyond a stale subitem row.
  const { data: movedSubitems } = await supabase
    .from("items")
    .update({ group_id: input.groupId })
    .eq("parent_id", input.itemId)
    .select("id");

  return {
    ok: true,
    data: {
      item: moved,
      subitemIds: (movedSubitems ?? []).map((s) => s.id),
    },
  };
}
