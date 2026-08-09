"use server";

import { createClient } from "@/lib/supabase/server";
import { attachmentPreviewUrlSchema } from "@/lib/validations/collaboration-actions";
import { isSheetParseable } from "@/lib/collaboration/attachments-format";
import { parseWorkbookSheets } from "@/lib/boards/spreadsheet/parse-workbook";
import {
  MAX_BYTES,
  PREVIEW_GRID_ROWS,
  type SheetPreview,
} from "@/lib/boards/spreadsheet/types";
import { fail, type ActionResult } from "@/lib/actions/result";

const PREVIEW_TTL = 300; // matches the gallery/lightbox preview window

/**
 * Parse an xlsx/xls/csv attachment into a bounded grid for the preview modal.
 *
 * Parsing happens HERE, on the server, reusing the import wizard's
 * `parseWorkbookSheets` — which already carries the zip-bomb guard (it rejects
 * on declared dimensions before allocating a grid) and the MAX_ROWS/MAX_COLS
 * caps. That keeps exceljs and its node-only dependencies out of the browser
 * bundle entirely, and means the client only ever receives plain strings that
 * React escapes on render — no HTML-injection surface by construction.
 */
export async function getAttachmentSheetPreview(input: {
  attachmentId: string;
}): Promise<ActionResult<{ sheets: SheetPreview[] }>> {
  const parsed = attachmentPreviewUrlSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  // RLS scopes this to the caller's org; a missing row is indistinguishable
  // from one they cannot see, which is the intent.
  const { data: row, error } = await supabase
    .from("attachments")
    .select("storage_path, mime_type, file_name, size_bytes")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (error || !row) return fail("Attachment not found.");

  if (!isSheetParseable(row.mime_type, row.file_name))
    return fail("Not a spreadsheet.");

  // Check the recorded size before spending a signed URL or a byte of transfer.
  if (row.size_bytes > MAX_BYTES)
    return fail("This spreadsheet is too large to preview.");

  const { data: signed, error: signErr } = await supabase.storage
    .from("attachments")
    .createSignedUrl(row.storage_path, PREVIEW_TTL);
  if (signErr || !signed) return fail("Could not read the file.");

  const res = await fetch(signed.signedUrl);
  if (!res.ok) return fail("Could not read the file.");
  const buf = Buffer.from(await res.arrayBuffer());
  // Re-check against the real byte length — size_bytes is client-reported.
  if (buf.length > MAX_BYTES)
    return fail("This spreadsheet is too large to preview.");

  let raw;
  try {
    raw = await parseWorkbookSheets(buf, row.file_name);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return fail(`Could not parse this spreadsheet: ${msg}`);
  }

  const sheets: SheetPreview[] = raw.map((s) => ({
    name: s.name,
    // rowCount/colCount describe the WHOLE sheet; grid is the truncated view,
    // so the UI can say "showing 200 of 4,000 rows".
    rowCount: s.grid.length,
    colCount: s.grid.reduce((max, r) => Math.max(max, r.length), 0),
    grid: s.grid.slice(0, PREVIEW_GRID_ROWS),
  }));

  return { ok: true, data: { sheets } };
}
