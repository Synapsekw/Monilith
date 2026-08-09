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
  attachmentPreviewUrlSchema,
} from "@/lib/validations/collaboration-actions";
import {
  isPreviewable,
  isInlineParseable,
} from "@/lib/collaboration/attachments-format";
import { fail, type ActionResult } from "@/lib/actions/result";
import { createAttachmentCore } from "./attachment-core";
import type { Json } from "@/types/database.types";

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
    const { error: notifErr } = await supabase.from("notifications").insert(
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
    // Best-effort fan-out: the update already posted (spec F3 / decision D4).
    if (notifErr)
      console.error("[notifications] mention fan-out failed", {
        itemId: parsed.data.itemId,
        recipients: recipients.length,
        error: notifErr.message,
      });
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

  // Guards + insert live in the core so the MCP path produces identical side
  // effects; this wrapper contributes only the cookie client and the actor.
  return createAttachmentCore(supabase, parsed.data, user.id);
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
  thumb?: { width: number; height: number };
}): Promise<
  ActionResult<{
    urls: Record<string, string>;
    thumbUrls: Record<string, string>;
  }>
> {
  const parsed = attachmentUrlsSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  if (parsed.data.attachmentIds.length === 0)
    return { ok: true, data: { urls: {}, thumbUrls: {} } };

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("attachments")
    .select("id, storage_path, mime_type")
    .in("id", parsed.data.attachmentIds);
  if (error || !rows) return fail("Could not load attachments.");

  // Inline preview only for the safe raster/video allow-list (no `download`).
  const previewable = rows.filter((r) => isPreviewable(r.mime_type));
  if (previewable.length === 0)
    return { ok: true, data: { urls: {}, thumbUrls: {} } };

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

  // Thumbnails: `createSignedUrls` (plural) has no `transform` option, so mint
  // width/height-constrained URLs per-file via `createSignedUrl` — image rows
  // only (video has no server-side transform). Best-effort: any that fail to
  // sign are simply omitted and the component falls back to full-res.
  const thumbUrls: Record<string, string> = {};
  const thumb = parsed.data.thumb;
  if (thumb) {
    const imageRows = previewable.filter((r) =>
      r.mime_type.startsWith("image/"),
    );
    const signedThumbs = await Promise.all(
      imageRows.map((r) =>
        supabase.storage
          .from("attachments")
          .createSignedUrl(r.storage_path, PREVIEW_TTL, {
            transform: {
              width: thumb.width,
              height: thumb.height,
              resize: "cover",
            },
          })
          .then((res) => ({ id: r.id, url: res.data?.signedUrl ?? null })),
      ),
    );
    for (const t of signedThumbs) if (t.url) thumbUrls[t.id] = t.url;
  }

  return { ok: true, data: { urls, thumbUrls } };
}

export async function getAttachmentPreviewUrl(input: {
  attachmentId: string;
}): Promise<ActionResult<{ url: string }>> {
  const parsed = attachmentPreviewUrlSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("attachments")
    .select("storage_path, mime_type, file_name")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (error || !row) return fail("Attachment not found.");

  // Defense in depth: the only bytes we ever sign for inline `fetch` (no
  // download disposition) are formats a parser consumes — PDF via PDF.js,
  // DOCX via docx-preview. The bytes reach a parser, never a top-level
  // navigation, so nothing signed here can execute script by being opened.
  if (!isInlineParseable(row.mime_type, row.file_name))
    return fail("Not a previewable file.");

  // No `download` disposition — bytes are consumed by fetch → canvas, never
  // top-level navigation. Short TTL (shared with the gallery preview window).
  const { data: signed, error: signErr } = await supabase.storage
    .from("attachments")
    .createSignedUrl(row.storage_path, PREVIEW_TTL);
  if (signErr || !signed) return fail("Could not sign preview URL.");
  return { ok: true, data: { url: signed.signedUrl } };
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
