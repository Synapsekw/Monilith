import type ExcelJS from "exceljs";
import type { ColumnKind } from "@/lib/validations/boards";
import { pillTextColor } from "@/lib/boards/contrast";

/** Six red→green bands mirroring src/lib/boards/percent-color.ts.
 *  Hex values are sRGB freezes of the light-mode --progress-* OKLCH tokens
 *  in src/app/globals.css (source of truth; re-derive if the tokens move). */
export type PercentBand =
  | "red"
  | "orange"
  | "amber"
  | "lime"
  | "green"
  | "complete";

export const PERCENT_BAND_HEX: Record<PercentBand, string> = {
  red: "#EA3A48",
  orange: "#F07437",
  amber: "#E5A83B",
  lime: "#8FC15D",
  green: "#3FAE71",
  complete: "#12965C",
};

export function percentBand(p: number): PercentBand {
  const v = Math.max(0, Math.min(100, p));
  if (v >= 100) return "complete";
  if (v >= 80) return "green";
  if (v >= 60) return "lime";
  if (v >= 40) return "amber";
  if (v >= 20) return "orange";
  return "red";
}

export const HEADER_FILL_HEX = "#1A1A1D";
export const SUBITEM_FG_HEX = "#6B7280";
const GROUP_COL_WIDTH = 18;
const NAME_COL_WIDTH = 32;
const DEFAULT_WIDTH = 14;

export const KIND_WIDTHS: Partial<Record<ColumnKind, number>> = {
  text: 24,
  link: 24,
  email: 24,
  people: 20,
  status: 16,
  dropdown: 16,
  phone: 14,
  date: 12,
  percent: 12,
  numbers: 10,
  checkbox: 10,
  rating: 8,
};

/** "#rgb"/"#rrggbb" → exceljs ARGB ("FFRRGGBB"); null when unparseable. */
export function argb(hex: string): string | null {
  if (typeof hex !== "string") return null;
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return null;
  return `FF${full.toUpperCase()}`;
}

function solidFill(argbColor: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb: argbColor } };
}

/** The fill color a status / single-select dropdown cell should carry, or null. Never throws. */
export function optionFillHex(
  kind: ColumnKind,
  value: unknown,
  settings: unknown,
): string | null {
  try {
    if (value == null || typeof value !== "object") return null;
    const s = settings as {
      options?: Array<{ id: string; color?: string }>;
    } | null;
    if (!s || !Array.isArray(s.options)) return null;

    let optionId: unknown = null;
    if (kind === "status") {
      optionId = (value as { optionId?: unknown }).optionId;
    } else if (kind === "dropdown") {
      const ids = (value as { optionIds?: unknown }).optionIds;
      if (Array.isArray(ids) && ids.length === 1) optionId = ids[0];
    } else {
      return null;
    }
    if (typeof optionId !== "string") return null;

    const opt = s.options.find((o) => o.id === optionId);
    return typeof opt?.color === "string" ? opt.color : null;
  } catch {
    return null;
  }
}

export type FormatPlan = {
  /** Board columns in emitted order; worksheet column = index + 3 (A=Group, B=Name). */
  columnKinds: ColumnKind[];
  /** One entry per emitted data row. */
  rows: { rowNumber: number; groupColor: string; isSubitem: boolean }[];
  /** Status / single-select dropdown fills. colIndex is 1-based worksheet column. */
  optionFills: { rowNumber: number; colIndex: number; hex: string }[];
  /** Percent cells with their numeric value (0–100). */
  percentCells: { rowNumber: number; colIndex: number; value: number }[];
};

/** Apply all board-fidelity styling to a fully-populated worksheet. Best-effort:
 *  bad colors degrade to unstyled cells; never throws. xlsx only — callers skip for csv. */
export function applyWorkbookFormatting(
  ws: ExcelJS.Worksheet,
  plan: FormatPlan,
): void {
  const totalCols = 2 + plan.columnKinds.length;

  // Header: bold white on near-black, frozen, filtered.
  const header = ws.getRow(1);
  header.height = 22;
  const headerArgb = argb(HEADER_FILL_HEX);
  for (let c = 1; c <= totalCols; c++) {
    const cell = header.getCell(c);
    if (headerArgb) cell.fill = solidFill(headerArgb);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: totalCols },
  };

  // Column widths.
  ws.getColumn(1).width = GROUP_COL_WIDTH;
  ws.getColumn(2).width = NAME_COL_WIDTH;
  plan.columnKinds.forEach((kind, i) => {
    ws.getColumn(3 + i).width = KIND_WIDTHS[kind] ?? DEFAULT_WIDTH;
  });

  // Group fills + subitem name styling.
  for (const row of plan.rows) {
    const groupArgb = argb(row.groupColor);
    if (groupArgb) {
      const cell = ws.getRow(row.rowNumber).getCell(1);
      cell.fill = solidFill(groupArgb);
      const fg = argb(pillTextColor(row.groupColor));
      if (fg) cell.font = { color: { argb: fg } };
    }
    if (row.isSubitem) {
      const nameFg = argb(SUBITEM_FG_HEX);
      ws.getRow(row.rowNumber).getCell(2).font = {
        italic: true,
        ...(nameFg ? { color: { argb: nameFg } } : {}),
      };
    }
  }

  // Status / single-select dropdown fills.
  for (const f of plan.optionFills) {
    const bg = argb(f.hex);
    if (!bg) continue;
    const cell = ws.getRow(f.rowNumber).getCell(f.colIndex);
    cell.fill = solidFill(bg);
    const fg = argb(pillTextColor(f.hex));
    if (fg) cell.font = { color: { argb: fg } };
    cell.alignment = { horizontal: "center" };
  }

  // Percent display format ("60%" while the stored value stays 60 → round-trip safe).
  for (const pc of plan.percentCells) {
    ws.getRow(pc.rowNumber).getCell(pc.colIndex).numFmt = '0"%"';
  }

  applyPercentDataBars(ws, plan);
}

// Placeholder until the data-bar task — keeps this task shippable and typecheck-green.
function applyPercentDataBars(
  _ws: ExcelJS.Worksheet,
  _plan: FormatPlan,
): void {}
