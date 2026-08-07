"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getBoardPayload } from "@/lib/boards/queries";
import { resolvePeopleNames } from "@/lib/boards/people-names";
import { buildExportWorkbook } from "@/lib/boards/spreadsheet/export-workbook";
import { parseWorkbookSheets } from "@/lib/boards/spreadsheet/parse-workbook";
import { selectRows } from "@/lib/boards/spreadsheet/select-rows";
import {
  buildImportPayloadV3,
  type ImportPayload,
} from "@/lib/boards/spreadsheet/build-import-payload";
import { buildAppendPayload } from "@/lib/boards/spreadsheet/build-append-payload";
import { findStructureValidationError } from "@/lib/boards/spreadsheet/structure-validate";
import {
  isKindCompatible,
  type BoardColumnRef,
} from "@/lib/boards/spreadsheet/match-columns";
import {
  MAX_BYTES,
  MAX_ROWS,
  MAX_COLS,
  PREVIEW_GRID_ROWS,
  importFormatFromFileName,
  type ImportFormat,
  type ImportPreview,
  type SheetPreview,
  type ColumnSpec,
  type ImportDestination,
  type ParsedTable,
  type SynthOption,
  type ImportGroup,
  type RowStructureEntry,
} from "@/lib/boards/spreadsheet/types";
import {
  exportBoardSchema,
  previewImportSchema,
  commitImportSchema,
} from "@/lib/validations/board-spreadsheet";
import { fail, type ActionResult } from "@/lib/actions/result";

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

/** items.name CHECK: char_length between 1 and 255. */
const ITEM_NAME_MAX = 255;

/**
 * Pre-commit scan mirroring the item-name derivation in `resolveStructuredRows`:
 * every selected row becomes an item/subitem whose name is the name cell,
 * imported verbatim (item/subitem type and grouping come from the explicit
 * `structure`, not a name-prefix marker). A blank name violates the items
 * CHECK (char_length ≥ 1)
 * and an over-long one violates its upper bound — either aborts the whole
 * atomic 2000-row batch in the RPC with a raw Postgres constraint message. We
 * catch them here with a row-numbered error BEFORE the RPC runs, so the user
 * sees which rows are at fault instead of a rolled-back import.
 *
 * Over-long names are blocked (not silently truncated): truncation would drop
 * data the user can't see was lost, so we surface the offending rows and let
 * them fix or exclude them.
 */
function findNameValidationError(
  table: ParsedTable,
  specs: ColumnSpec[],
): string | null {
  const nameSpec = specs.find((s) => s.role === "name");
  // A missing name column is caught downstream by the payload builders
  // ("no name column"); nothing to validate here.
  if (!nameSpec) return null;

  const blankRows: number[] = [];
  const oversizedRows: number[] = [];

  table.rows.forEach((row, i) => {
    const name = (row[nameSpec.sourceIndex] ?? "").trim();
    // 1-based original grid row number — matches the wizard's row labels.
    const rowNumber = table.rowIndices[i] + 1;
    if (name === "") blankRows.push(rowNumber);
    // char_length counts code points like Postgres — use the spread length.
    else if ([...name].length > ITEM_NAME_MAX) oversizedRows.push(rowNumber);
  });

  const fmt = (rows: number[]): string => {
    const shown = rows.slice(0, 5).map((n) => `row ${n}`);
    const extra = rows.length - shown.length;
    return extra > 0 ? `${shown.join(", ")}, +${extra} more` : shown.join(", ");
  };

  if (blankRows.length > 0) {
    return `${blankRows.length} row(s) have a blank item name (${fmt(
      blankRows,
    )}). Every imported row needs a name — fill them in or exclude those rows.`;
  }
  if (oversizedRows.length > 0) {
    return `${oversizedRows.length} row(s) have an item name longer than ${ITEM_NAME_MAX} characters (${fmt(
      oversizedRows,
    )}). Shorten them or exclude those rows.`;
  }
  return null;
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
  const { data: board, error: rpcError } = await typedRpc(
    supabase,
    "create_board_from_template",
    {
      p_workspace_id: workspaceId,
      p_name: boardName,
      p_template: payload.templatePayload,
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

/**
 * Append imported rows into an EXISTING board's group via the atomic
 * `import_rows_into_board` RPC (Task 13). Unlike `insertNewBoard`, this is a
 * single server-side transaction — there is no "phase 2" and no client-side
 * rollback to perform.
 *
 * Column targets and kind compatibility are validated up front against the
 * board's actual columns (an RLS-scoped fetch of `columns` by `board_id`) so
 * `buildAppendPayload` never has to guess at a stale/missing target; a
 * `boardId` that resolves to zero columns is disambiguated against a direct
 * `boards` existence check so a genuinely-missing board fails with a clear
 * "Board not found." instead of silently importing into nothing.
 */
async function appendToExistingBoard(
  supabase: SupabaseServerClient,
  boardId: string,
  table: ParsedTable,
  specs: ColumnSpec[],
  groups: ImportGroup[],
  structure: RowStructureEntry[],
  format: ImportFormat,
): Promise<{ ok: true; boardId: string } | { ok: false; error: string }> {
  const { data: columnRows, error: columnsError } = await supabase
    .from("columns")
    .select("id, kind, name, settings")
    .eq("board_id", boardId);

  if (columnsError) return { ok: false, error: columnsError.message };

  if (!columnRows || columnRows.length === 0) {
    const { data: boardRows } = await supabase
      .from("boards")
      .select("id")
      .eq("id", boardId);
    if (!boardRows || boardRows.length === 0) {
      return { ok: false, error: "Board not found." };
    }
  }

  const boardColumns: BoardColumnRef[] = (columnRows ?? []).map((col) => {
    const settings = col.settings as { options?: SynthOption[] } | null;
    const options =
      (col.kind === "status" || col.kind === "dropdown") &&
      settings &&
      Array.isArray(settings.options)
        ? settings.options
        : [];
    return { id: col.id, name: col.name, kind: col.kind, options };
  });

  for (const spec of specs) {
    if (spec.role !== "data" || spec.target === "skip") continue;
    const target = spec.target;
    if (!target || target === "create") continue;

    const boardColumn = boardColumns.find((col) => col.id === target.columnId);
    if (!boardColumn) {
      return {
        ok: false,
        error: `Column "${spec.name}" targets a column that isn't on this board.`,
      };
    }
    if (!isKindCompatible(spec.kind, boardColumn.kind)) {
      return {
        ok: false,
        error: `Column "${spec.name}" isn't compatible with the target column's type.`,
      };
    }
  }

  let payload;
  try {
    payload = buildAppendPayload(
      table,
      specs,
      boardColumns,
      groups,
      structure,
      format,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }

  const { error: rpcError } = await typedRpc(
    supabase,
    "import_rows_into_board",
    {
      p_board_id: boardId,
      p_payload: payload,
    },
  );

  if (rpcError) return { ok: false, error: rpcError.message };

  return { ok: true, boardId };
}

export async function commitImport(input: {
  fileBase64: string;
  fileName: string;
  sheetName: string;
  headerRow: number | null;
  excludedRows: number[];
  columns: ColumnSpec[];
  groups: ImportGroup[];
  structure: RowStructureEntry[];
  destination: ImportDestination;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = commitImportSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const guard = guardFile(parsed.data.fileBase64, parsed.data.fileName);
  if (!guard.ok) return fail(guard.error);

  // The CSV formula-guard undo in `textToCell` (cell-codec.ts) only applies
  // to CSV — `guardCsvCell` in export-workbook.ts never quotes xlsx cells,
  // so undoing on an xlsx import would strip a user-typed leading `'` for no
  // reason. This is the one place that knows the real uploaded filename, so
  // it's the seam that threads the real format down into the two builders.
  const format = importFormatFromFileName(parsed.data.fileName);

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

  // Block blank / over-long item names up front so a single bad row doesn't
  // roll back the whole batch with a raw constraint error from the RPC.
  const nameError = findNameValidationError(table, parsed.data.columns);
  if (nameError) return fail(nameError);

  const structureError = findStructureValidationError(
    table,
    parsed.data.groups,
    parsed.data.structure,
  );
  if (structureError) return fail(structureError);

  const supabase = await createClient();

  if (parsed.data.destination.type === "existing") {
    const result = await appendToExistingBoard(
      supabase,
      parsed.data.destination.boardId,
      table,
      parsed.data.columns,
      parsed.data.groups,
      parsed.data.structure,
      format,
    );
    if (!result.ok) return fail(result.error);

    revalidatePath(`/boards/${result.boardId}`);
    return { ok: true, data: { boardId: result.boardId } };
  }

  const payload = buildImportPayloadV3(
    table,
    parsed.data.columns,
    parsed.data.groups,
    parsed.data.structure,
    format,
  );
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
