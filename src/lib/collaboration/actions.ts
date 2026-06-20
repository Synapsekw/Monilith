"use server";

import { createClient } from "@/lib/supabase/server";
import {
  addUpdateSchema,
  editUpdateSchema,
  deleteUpdateSchema,
  markNotificationReadSchema,
  createAttachmentSchema,
  deleteAttachmentSchema,
  attachmentUrlSchema,
  attachmentUrlsSchema,
} from "@/lib/validations/collaboration-actions";
import { isPreviewable } from "@/lib/collaboration/attachments-format";
import type { ActionResult } from "@/lib/boards/actions";
import type { Json } from "@/types/database.types";

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

export async function addUpdate(input: {
  itemId: string;
  text: string;
  mentions?: string[];
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
      body: { text: parsed.data.text, mentions: parsed.data.mentions } as Json,
      body_text: parsed.data.text,
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not post update.");

  // Fan out one notification per mentioned member (deduped, excluding self).
  const recipients = [...new Set(parsed.data.mentions)].filter(
    (id) => id !== user.id,
  );
  if (recipients.length > 0) {
    await supabase.from("notifications").insert(
      recipients.map((rid) => ({
        org_id: item.org_id,
        recipient_id: rid,
        actor_id: user.id,
        kind: "mention" as const,
        board_id: item.board_id,
        item_id: parsed.data.itemId,
        update_id: data.id,
      })),
    );
  }

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

export async function markNotificationRead(input: {
  notificationId: string;
}): Promise<ActionResult> {
  const parsed = markNotificationReadSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  // RLS scopes the update to the recipient's own rows.
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data.notificationId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", user.id)
    .is("read_at", null);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

const DOWNLOAD_TTL = 60; // short-lived; re-minted per click
const PREVIEW_TTL = 300; // inline preview window for the gallery/lightbox

export async function createAttachment(input: {
  itemId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  columnId?: string;
}): Promise<ActionResult<{ attachmentId: string }>> {
  const parsed = createAttachmentSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // Re-derive org/board from the item (RLS-scoped) and reject any path not
  // under this org/board/item — a client cannot register a row pointing at
  // another tenant's object (path-spoof guard).
  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("org_id, board_id")
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  if (itemErr || !item) return fail("Item not found.");

  // Files-column attachments nest the column id into the path; item-level ones
  // do not. The prefix guard rejects any path outside this org/board/item(/col).
  const prefix = parsed.data.columnId
    ? `${item.org_id}/${item.board_id}/${parsed.data.itemId}/${parsed.data.columnId}/`
    : `${item.org_id}/${item.board_id}/${parsed.data.itemId}/`;
  if (!parsed.data.storagePath.startsWith(prefix))
    return fail("Storage path does not match this item.");

  // A column-scoped attachment must target a Files column on this item's board.
  if (parsed.data.columnId) {
    const { data: col } = await supabase
      .from("columns")
      .select("id, kind, board_id")
      .eq("id", parsed.data.columnId)
      .maybeSingle();
    if (!col || col.board_id !== item.board_id || col.kind !== "files")
      return fail("Invalid file column.");
  }

  const { data, error } = await supabase
    .from("attachments")
    .insert({
      org_id: item.org_id,
      board_id: item.board_id,
      item_id: parsed.data.itemId,
      column_id: parsed.data.columnId ?? null,
      uploaded_by: user.id,
      storage_path: parsed.data.storagePath,
      file_name: parsed.data.fileName,
      mime_type: parsed.data.mimeType,
      size_bytes: parsed.data.sizeBytes,
    })
    .select("id")
    .single();
  if (error || !data)
    return fail(error?.message ?? "Could not register attachment.");
  return { ok: true, data: { attachmentId: data.id } };
}

export async function getAttachmentDownloadUrl(input: {
  attachmentId: string;
}): Promise<ActionResult<{ url: string }>> {
  const parsed = attachmentUrlSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("attachments")
    .select("storage_path, file_name")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (error || !row) return fail("Attachment not found.");

  // Attachment disposition forces a download (never a top-level render) — the
  // "any type" XSS mitigation for HTML/SVG uploads.
  const { data: signed, error: signErr } = await supabase.storage
    .from("attachments")
    .createSignedUrl(row.storage_path, DOWNLOAD_TTL, {
      download: row.file_name,
    });
  if (signErr || !signed) return fail("Could not sign download URL.");
  return { ok: true, data: { url: signed.signedUrl } };
}

export async function getAttachmentPreviewUrls(input: {
  attachmentIds: string[];
}): Promise<ActionResult<{ urls: Record<string, string> }>> {
  const parsed = attachmentUrlsSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  if (parsed.data.attachmentIds.length === 0)
    return { ok: true, data: { urls: {} } };

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("attachments")
    .select("id, storage_path, mime_type")
    .in("id", parsed.data.attachmentIds);
  if (error || !rows) return fail("Could not load attachments.");

  // Inline preview only for the safe raster/video allow-list (no `download`).
  const previewable = rows.filter((r) => isPreviewable(r.mime_type));
  if (previewable.length === 0) return { ok: true, data: { urls: {} } };

  const paths = previewable.map((r) => r.storage_path);
  const { data: signed, error: signErr } = await supabase.storage
    .from("attachments")
    .createSignedUrls(paths, PREVIEW_TTL);
  if (signErr || !signed) return fail("Could not sign preview URLs.");

  const byPath = new Map(
    signed
      .filter((s) => s.signedUrl)
      .map((s) => [s.path as string, s.signedUrl as string]),
  );
  const urls: Record<string, string> = {};
  for (const r of previewable) {
    const u = byPath.get(r.storage_path);
    if (u) urls[r.id] = u;
  }
  return { ok: true, data: { urls } };
}

export async function deleteAttachment(input: {
  attachmentId: string;
}): Promise<ActionResult> {
  const parsed = deleteAttachmentSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("attachments")
    .select("id, storage_path")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  // RLS already hides rows outside the caller's org; a missing row is a no-op.
  if (error || !row) return fail("Attachment not found.");

  // Object first so a metadata row never dangles pointing at live bytes.
  // Storage RLS independently enforces uploader-or-admin on the object.
  const { error: rmErr } = await supabase.storage
    .from("attachments")
    .remove([row.storage_path]);
  if (rmErr) return fail("Could not remove file.");

  // Table RLS enforces uploader-or-admin on the row delete (the real guard).
  const { error: delErr } = await supabase
    .from("attachments")
    .delete()
    .eq("id", row.id);
  if (delErr) return fail(delErr.message);
  return { ok: true, data: undefined };
}
