"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getBoardPayload, type BoardPayload } from "@/lib/boards/queries";
import { buildExportWorkbook } from "@/lib/boards/spreadsheet/export-workbook";
import { parseWorkbookSheets } from "@/lib/boards/spreadsheet/parse-workbook";
import { selectRows } from "@/lib/boards/spreadsheet/select-rows";
import {
  buildImportPayloadV2,
  type ImportPayload,
} from "@/lib/boards/spreadsheet/build-import-payload";
import {
  MAX_BYTES,
  MAX_ROWS,
  MAX_COLS,
  PREVIEW_GRID_ROWS,
  type ImportFormat,
  type ImportPreview,
  type SheetPreview,
  type ColumnSpec,
  type ImportDestination,
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

  let rawSheets;
  try {
    rawSheets = await parseWorkbookSheets(guard.buf, parsed.data.fileName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Could not parse file: ${msg}`);
  }

  const sheets: SheetPreview[] = [];
  for (const raw of rawSheets) {
    const colCount = raw.grid.reduce(
      (max, row) => Math.max(max, row.length),
      0,
    );
    // No row-cap failure at preview: rowCount is surfaced for the UI to warn
    // with; MAX_ROWS is only enforced against the selected table at commit.
    if (colCount > MAX_COLS) {
      return fail(
        `Sheet "${raw.name}" has too many columns (${colCount}). Maximum allowed is ${MAX_COLS}.`,
      );
    }
    sheets.push({
      name: raw.name,
      rowCount: raw.grid.length,
      colCount,
      grid: raw.grid.slice(0, PREVIEW_GRID_ROWS),
    });
  }

  // boardName = fileName without extension
  const boardName = parsed.data.fileName.replace(/\.[^.]+$/, "");

  return {
    ok: true,
    data: { fileName: parsed.data.fileName, boardName, sheets },
  };
}

// ─── commitImport ─────────────────────────────────────────────────────────────

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Create a brand-new board from an import payload.
 * Phase 1: create the board via the atomic `create_board_from_template` RPC.
 * Phase 2: insert subitems (they require a board_id that only exists after
 * phase 1). The phase-1 RPC has already committed, so this is NOT one atomic
 * transaction — on failure we best-effort delete the just-created board
 * (cascade) to avoid orphaning a half-built board. The delete runs on the same
 * RLS-bound client, so it can only ever remove a board the caller may delete.
 * org_id/board_id come from the membership-checked RPC's return row (never
 * client input); the client-supplied group_id/parent_id/column_id are confined
 * to the caller's org by the items/cell_values RLS insert policies.
 */
async function insertNewBoard(
  supabase: SupabaseServerClient,
  workspaceId: string,
  boardName: string,
  payload: ImportPayload,
): Promise<{ ok: true; boardId: string } | { ok: false; error: string }> {
  const { data: board, error: rpcError } = await supabase.rpc(
    "create_board_from_template",
    {
      p_workspace_id: workspaceId,
      p_name: boardName,
      p_template: payload.templatePayload as unknown as Json,
    },
  );

  if (rpcError || !board) {
    return { ok: false, error: rpcError?.message ?? "Could not create board." };
  }

  const boardId = (board as { id: string; org_id: string }).id;
  const orgId = (board as { id: string; org_id: string }).org_id;

  const { subitems } = payload;
  if (subitems.length > 0) {
    const subitemRows = subitems.map((s) => ({
      id: s.id,
      org_id: orgId,
      board_id: boardId,
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
      await supabase.from("boards").delete().eq("id", boardId);
      return { ok: false, error: itemsError.message };
    }

    // Insert subitem cell values
    const cellRows = subitems.flatMap((s) =>
      s.cells.map((c) => ({
        org_id: orgId,
        board_id: boardId,
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
        await supabase.from("boards").delete().eq("id", boardId);
        return { ok: false, error: cellsError.message };
      }
    }
  }

  return { ok: true, boardId };
}

export async function commitImport(input: {
  fileBase64: string;
  fileName: string;
  sheetName: string;
  headerRow: number | null;
  excludedRows: number[];
  columns: ColumnSpec[];
  destination: ImportDestination;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = commitImportSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const guard = guardFile(parsed.data.fileBase64, parsed.data.fileName);
  if (!guard.ok) return fail(guard.error);

  let rawSheets;
  try {
    rawSheets = await parseWorkbookSheets(guard.buf, parsed.data.fileName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Could not parse file: ${msg}`);
  }

  const rawSheet = rawSheets.find((s) => s.name === parsed.data.sheetName);
  if (!rawSheet) return fail("Sheet not found.");

  let table;
  try {
    table = selectRows(
      rawSheet.grid,
      parsed.data.headerRow,
      parsed.data.excludedRows,
    );
  } catch {
    return fail("The selected sheet has no data to import.");
  }

  if (table.rows.length > MAX_ROWS) {
    return fail(
      `Sheet has too many rows (${table.rows.length}). Maximum allowed is ${MAX_ROWS}.`,
    );
  }
  if (table.header.length > MAX_COLS) {
    return fail(
      `Sheet has too many columns (${table.header.length}). Maximum allowed is ${MAX_COLS}.`,
    );
  }

  for (const spec of parsed.data.columns) {
    if (spec.sourceIndex >= table.header.length) {
      return fail(
        `Column "${spec.name}" refers to a column that isn't in the selected header.`,
      );
    }
  }

  const payload = buildImportPayloadV2(table, parsed.data.columns);

  if (parsed.data.destination.type === "existing") {
    return fail("Importing into an existing board is not available yet.");
  }

  const supabase = await createClient();
  const result = await insertNewBoard(
    supabase,
    parsed.data.destination.workspaceId,
    parsed.data.destination.boardName,
    payload,
  );
  if (!result.ok) return fail(result.error);

  revalidatePath("/", "layout");
  return { ok: true, data: { boardId: result.boardId } };
}
