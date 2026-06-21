"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";
import { setRelationLinksSchema } from "@/lib/validations/board-actions";
import type { ActionResult } from "@/lib/boards/actions";

type RelationLinkRow = Tables<"relation_links">;

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

/** Replace a relation cell's links (link/unlink/reorder in one call). */
export async function setRelationLinks(input: {
  itemId: string;
  columnId: string;
  linkedItemIds: string[];
}): Promise<ActionResult<{ links: RelationLinkRow[] }>> {
  const parsed = setRelationLinksSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("items")
    .select("board_id")
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  if (!item) return fail("Item not found.");

  const { data, error } = await supabase.rpc("set_relation_links", {
    p_item_id: parsed.data.itemId,
    p_column_id: parsed.data.columnId,
    p_linked_item_ids: parsed.data.linkedItemIds,
  });
  if (error) return fail(error.message);

  revalidatePath(`/boards/${item.board_id}`);
  return { ok: true, data: { links: (data ?? []) as RelationLinkRow[] } };
}
