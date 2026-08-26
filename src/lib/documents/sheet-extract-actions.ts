"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { parseWorkbookSheets } from "@/lib/boards/spreadsheet/parse-workbook";
import { MAX_BYTES } from "@/lib/boards/spreadsheet/types";
import { isSheetParseable } from "@/lib/collaboration/attachments-format";
import { fail, type ActionResult } from "@/lib/actions/result";

/**
 * Flatten a workbook to plain text for the reference-document library.
 *
 * Parsing happens HERE, on the server, for the same reason
 * sheet-preview-actions.ts gives: `parseWorkbookSheets` already carries the
 * zip-bomb guard and the MAX_ROWS/MAX_COLS caps, and exceljs has node-only
 * dependencies. Doing this in the browser would trade a security control for
 * one saved round trip.
 *
 * The bytes are parsed in memory and never persisted — no bucket, no
 * attachment row. Only the extracted text is returned, and only the owner's
 * edited version of it is ever stored.
 */

const schema = z.object({
  fileName: z.string().min(1).max(255),
  bytes: z.string().min(1),
});

export async function extractSheetText(input: {
  fileName: string;
  bytes: string;
}): Promise<ActionResult<{ text: string }>> {
  // AUTHENTICATED CALLERS ONLY. This action takes base64 off the wire and
  // hands up to MAX_BYTES of it to exceljs — a parser with a zip-bomb guard
  // precisely because the input is hostile-by-assumption. Reading no data and
  // writing none is not a reason to leave it open to anonymous callers: it is
  // real server CPU and memory, reachable from anywhere, for free.
  await requireUser();

  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input.");

  const { fileName, bytes } = parsed.data;
  if (!isSheetParseable("", fileName))
    return fail("That file isn't a spreadsheet.");

  const buf = Buffer.from(bytes, "base64");
  if (buf.byteLength > MAX_BYTES)
    return fail("That spreadsheet is too large to read.");

  let sheets: Awaited<ReturnType<typeof parseWorkbookSheets>>;
  try {
    sheets = await parseWorkbookSheets(buf, fileName);
  } catch {
    // The parser throws on malformed archives and on the zip-bomb guard. The
    // owner gets one message either way; distinguishing them would tell an
    // attacker which guard fired.
    return fail("We couldn't read that spreadsheet.");
  }

  const text = sheets
    .map((s) => {
      // RawSheet's field is `grid` (src/lib/boards/spreadsheet/types.ts),
      // not `rows` — verified against the real type before wiring this up.
      const rows = s.grid
        .map((r) =>
          r
            .map((c) => String(c ?? "").trim())
            .join("\t")
            .trim(),
        )
        .filter(Boolean);
      return rows.length ? `## ${s.name}\n\n${rows.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  if (text.trim().length === 0)
    return fail(
      "That spreadsheet has no text we could extract. Paste the content instead.",
    );

  return { ok: true, data: { text } };
}
