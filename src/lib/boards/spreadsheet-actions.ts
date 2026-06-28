"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getBoardPayload, type BoardPayload } from "@/lib/boards/queries";
import { buildExportWorkbook } from "@/lib/boards/spreadsheet/export-workbook";
import { parseWorkbook } from "@/lib/boards/spreadsheet/parse-workbook";
import { detectColumns } from "@/lib/boards/spreadsheet/detect";
import { buildImportPayload } from "@/lib/boards/spreadsheet/build-import-payload";
import {
  MAX_BYTES,
  MAX_ROWS,
  MAX_COLS,
  type ImportFormat,
  type ImportPreview,
  type ColumnMapping,
} from "@/lib/boards/spreadsheet/types";
import {
  exportBoardSchema,
  previewImportSchema,
  commitImportSchema,
} from "@/lib/validations/board-spreadsheet";
import type { Json } from "@/types/database.types";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

/** Characters forbidden in file names across Windows/Linux/macOS. */
const FORBIDDEN_FILENAME_RE = /[<>:"/\\|?*\x00-\x1f]/g;

function sanitizeFileName(name: string): string {
  return name.replace(FORBIDDEN_FILENAME_RE, "").trim() || "board";
}

/**
 * Decode a base64 string to a Buffer and enforce file-level guards:
 * - Buffer must not exceed MAX_BYTES
 * - File extension must be .xlsx or .csv
 *
 * Returns `{ok:true, data: {buf, ext}}` or `{ok:false, error}`.
 */
function guardFile(
  fileBase64: string,
  fileName: string,
):
  | { ok: true; buf: Buffer; ext: "xlsx" | "csv" }
  | { ok: false; error: string } {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext !== "xlsx" && ext !== "csv") {
    return fail("Only .xlsx and .csv files are supported.");
  }

  const buf = Buffer.from(fileBase64, "base64");
  if (buf.length > MAX_BYTES) {
    return fail(
      `File is too large (${buf.length} bytes). Maximum allowed size is ${MAX_BYTES} bytes.`,
    );
  }

  return { ok: true, buf, ext };
}

// ─── exportBoard ──────────────────────────────────────────────────────────────

export async function exportBoard(input: {
  boardId: string;
  format: ImportFormat;
}): Promise<ActionResult<{ fileName: string; base64: string; mime: string }>> {
  const parsed = exportBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const payload = await getBoardPayload(parsed.data.boardId);
  if (!payload) return fail("Board not found.");

  // Resolve people-column assignee display names so they export as names
  // rather than blank. Collect every user id referenced by a people cell,
  // then read their profiles in one RLS-scoped query. Unresolved ids are
  // dropped downstream; boards with no people cells skip the query entirely.
  const peopleNames = await resolvePeopleNames(payload);

  const { buffer, mime, ext } = await buildExportWorkbook(
    payload,
    parsed.data.format,
    peopleNames,
  );

  const safeName = sanitizeFileName(payload.board.name);
  const fileName = `${safeName}.${ext}`;
  const base64 = buffer.toString("base64");

  return { ok: true, data: { fileName, base64, mime } };
}

/**
 * Build a `userId → display name` map for the people cells in a board payload.
 * Returns an empty map (and skips the DB read) when the board has no people
 * columns or no assignees. RLS-scoped read of `profiles(id, full_name)`; ids
 * whose profile is missing or has no name are simply absent from the map and
 * get dropped at render time.
 */
async function resolvePeopleNames(
  payload: BoardPayload,
): Promise<Map<string, string>> {
  const peopleColumnIds = new Set(
    payload.columns.filter((c) => c.kind === "people").map((c) => c.id),
  );
  if (peopleColumnIds.size === 0) return new Map();

  const userIds = new Set<string>();
  for (const cv of payload.cellValues) {
    if (!peopleColumnIds.has(cv.column_id)) continue;
    const ids = (cv.value as { userIds?: unknown } | null)?.userIds;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) if (typeof id === "string") userIds.add(id);
  }
  if (userIds.size === 0) return new Map();

  const supabase = await createClient();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", [...userIds]);

  const map = new Map<string, string>();
  for (const p of profiles ?? []) {
    if (p.full_name) map.set(p.id, p.full_name);
  }
  return map;
}

// ─── previewImport ────────────────────────────────────────────────────────────

export async function previewImport(input: {
  fileBase64: string;
  fileName: string;
}): Promise<ActionResult<ImportPreview>> {
  const parsed = previewImportSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const guard = guardFile(parsed.data.fileBase64, parsed.data.fileName);
  if (!guard.ok) return fail(guard.error);

  let sheet;
  try {
    sheet = await parseWorkbook(guard.buf, parsed.data.fileName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Could not parse file: ${msg}`);
  }

  if (sheet.rows.length > MAX_ROWS) {
    return fail(
      `File has too many rows (${sheet.rows.length}). Maximum allowed is ${MAX_ROWS}.`,
    );
  }
  if (sheet.header.length > MAX_COLS) {
    return fail(
      `File has too many columns (${sheet.header.length}). Maximum allowed is ${MAX_COLS}.`,
    );
  }

  const columns = detectColumns(sheet.header, sheet.rows);

  // boardName = fileName without extension
  const boardName = parsed.data.fileName.replace(/\.[^.]+$/, "");
  const sampleRows = sheet.rows.slice(0, 5);

  return {
    ok: true,
    data: {
      boardName,
      columns,
      rowCount: sheet.rows.length,
      sampleRows,
      droppedSheets: sheet.droppedSheets,
    },
  };
}

// ─── commitImport ─────────────────────────────────────────────────────────────

export async function commitImport(input: {
  fileBase64: string;
  fileName: string;
  workspaceId: string;
  boardName: string;
  columnMappings: ColumnMapping[];
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = commitImportSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const guard = guardFile(parsed.data.fileBase64, parsed.data.fileName);
  if (!guard.ok) return fail(guard.error);

  let sheet;
  try {
    sheet = await parseWorkbook(guard.buf, parsed.data.fileName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Could not parse file: ${msg}`);
  }

  if (sheet.rows.length > MAX_ROWS) {
    return fail(
      `File has too many rows (${sheet.rows.length}). Maximum allowed is ${MAX_ROWS}.`,
    );
  }
  if (sheet.header.length > MAX_COLS) {
    return fail(
      `File has too many columns (${sheet.header.length}). Maximum allowed is ${MAX_COLS}.`,
    );
  }

  const { templatePayload, subitems } = buildImportPayload(
    sheet,
    parsed.data.columnMappings as ColumnMapping[],
  );

  const supabase = await createClient();

  // Phase 1: Create the board via the atomic RPC
  const { data: board, error: rpcError } = await supabase.rpc(
    "create_board_from_template",
    {
      p_workspace_id: parsed.data.workspaceId,
      p_name: parsed.data.boardName,
      p_template: templatePayload as unknown as Json,
    },
  );

  if (rpcError || !board) {
    return fail(rpcError?.message ?? "Could not create board.");
  }

  // Phase 2: Insert subitems (they require a board_id that only exists after
  // phase 1). The phase-1 RPC has already committed, so this is NOT one atomic
  // transaction — on failure we best-effort delete the just-created board
  // (cascade) to avoid orphaning a half-built board. The delete runs on the same
  // RLS-bound client, so it can only ever remove a board the caller may delete.
  // org_id/board_id come from the membership-checked RPC's return row (never
  // client input); the client-supplied group_id/parent_id/column_id are confined
  // to the caller's org by the items/cell_values RLS insert policies.
  if (subitems.length > 0) {
    const subitemRows = subitems.map((s) => ({
      id: s.id,
      org_id: (board as { id: string; org_id: string }).org_id,
      board_id: (board as { id: string; org_id: string }).id,
      group_id: s.groupId,
      parent_id: s.parentId,
      name: s.name,
      position: s.position,
    }));

    const { error: itemsError } = await supabase
      .from("items")
      .insert(subitemRows);

    if (itemsError) {
      // Rollback: delete the board (cascade removes groups/columns/items/cells)
      await supabase
        .from("boards")
        .delete()
        .eq("id", (board as { id: string; org_id: string }).id);
      return fail(itemsError.message);
    }

    // Insert subitem cell values
    const cellRows = subitems.flatMap((s) =>
      s.cells.map((c) => ({
        org_id: (board as { id: string; org_id: string }).org_id,
        board_id: (board as { id: string; org_id: string }).id,
        item_id: s.id,
        column_id: c.columnId,
        value: c.value,
      })),
    );

    if (cellRows.length > 0) {
      const { error: cellsError } = await supabase
        .from("cell_values")
        .insert(cellRows);

      if (cellsError) {
        // Rollback: delete the board
        await supabase
          .from("boards")
          .delete()
          .eq("id", (board as { id: string; org_id: string }).id);
        return fail(cellsError.message);
      }
    }
  }

  revalidatePath("/", "layout");
  return {
    ok: true,
    data: { boardId: (board as { id: string; org_id: string }).id },
  };
}
