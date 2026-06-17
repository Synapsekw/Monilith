"use server";

import { createClient } from "@/lib/supabase/server";
import {
  addUpdateSchema,
  editUpdateSchema,
  deleteUpdateSchema,
} from "@/lib/validations/collaboration-actions";
import type { ActionResult } from "@/lib/boards/actions";
import type { Json } from "@/types/database.types";

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

export async function addUpdate(input: {
  itemId: string;
  text: string;
}): Promise<ActionResult<{ updateId: string }>> {
  const parsed = addUpdateSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // org_id/board_id are denormalized — derive them from the item (RLS-scoped).
  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("org_id, board_id")
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  if (itemErr || !item) return fail("Item not found.");

  const { data, error } = await supabase
    .from("item_updates")
    .insert({
      org_id: item.org_id,
      board_id: item.board_id,
      item_id: parsed.data.itemId,
      author_id: user.id,
      body: { text: parsed.data.text } as Json,
      body_text: parsed.data.text,
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not post update.");

  return { ok: true, data: { updateId: data.id } };
}

export async function editUpdate(input: {
  updateId: string;
  text: string;
}): Promise<ActionResult> {
  const parsed = editUpdateSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("item_updates")
    .update({
      body: { text: parsed.data.text } as Json,
      body_text: parsed.data.text,
      edited_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.updateId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Update not found.");
  return { ok: true, data: undefined };
}

export async function deleteUpdate(input: {
  updateId: string;
}): Promise<ActionResult> {
  const parsed = deleteUpdateSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("item_updates")
    .delete()
    .eq("id", parsed.data.updateId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}
