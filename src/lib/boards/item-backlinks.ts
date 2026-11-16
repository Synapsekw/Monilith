"use server";

import * as z from "zod";

import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/actions/result";

/** How many backlinks the item panel shows. One page; the rest is counted as
 *  "more" (see `hasMore`), never loaded. */
const BACKLINK_LIMIT = 25;

const itemBacklinksInputSchema = z.object({ itemId: z.string().uuid() });

/** One relation link pointing AT the open item, as the panel renders it. */
export type ItemBacklink = {
  /** relation_links.id: one item linking through two columns is two rows. */
  linkId: string;
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  /** The relation column on the linking board that holds the link. */
  columnName: string;
};

export type ItemBacklinks = { links: ItemBacklink[]; hasMore: boolean };

/**
 * Items that link TO `itemId` through a relation column ("Linked from").
 *
 * - Bounded: one indexed lookup on `relation_links_linked_idx`
 *   (`linked_item_id`), capped at {@link BACKLINK_LIMIT} (+1 row to know
 *   whether more exist). Runs when the panel's Fields tab opens, never on
 *   board first paint.
 * - RLS is the boundary: a `relation_links` row is readable only when the
 *   caller can read its OWNING board (`board_id`), and the embedded item,
 *   board and column are RLS-filtered too. The joins are INNER, so a link the
 *   caller cannot fully see is dropped by the database, not by this code.
 * - Archived items and boards are excluded IN the query (inner-join filters),
 *   not after the limit, so a page is never short because of them.
 */
export async function listItemBacklinks(
  itemId: string,
): Promise<ActionResult<ItemBacklinks>> {
  const parsed = itemBacklinksInputSchema.safeParse({ itemId });
  if (!parsed.success) return fail("Invalid item.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("relation_links")
    .select(
      "id, items!relation_links_item_id_fkey!inner(id, name), boards!inner(id, name), columns!inner(name)",
    )
    .eq("linked_item_id", parsed.data.itemId)
    .is("items.archived_at", null)
    .is("boards.archived_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(BACKLINK_LIMIT + 1);
  if (error) return fail("Could not load linked items.");

  const rows = data ?? [];
  return {
    ok: true,
    data: {
      links: rows.slice(0, BACKLINK_LIMIT).map((row) => ({
        linkId: row.id,
        itemId: row.items.id,
        itemName: row.items.name,
        boardId: row.boards.id,
        boardName: row.boards.name,
        columnName: row.columns.name,
      })),
      hasMore: rows.length > BACKLINK_LIMIT,
    },
  };
}
