import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database.types";

export type Attachment = Tables<"attachments">;

const ATTACHMENTS_LIMIT = 50;

/**
 * Bounded list of an item's attachments — latest 50, item_id-indexed,
 * newest first. Metadata only; signed URLs are minted separately in the
 * Files surface so this read stays cheap. `cursor` (created_at) enables
 * a future "load more" without changing the call sites.
 */
export async function getItemAttachments(
  itemId: string,
  cursor?: string,
): Promise<Attachment[]> {
  const supabase = createClient();
  let q = supabase
    .from("attachments")
    .select("*")
    .eq("item_id", itemId)
    .order("created_at", { ascending: false })
    .limit(ATTACHMENTS_LIMIT);
  if (cursor) q = q.lt("created_at", cursor);
  const { data } = await q;
  return (data ?? []) as Attachment[];
}
