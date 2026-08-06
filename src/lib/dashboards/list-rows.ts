import type { ColumnOption } from "@/lib/dashboards/widget-data";
import { currencyOf, formatCurrency } from "@/lib/boards/currency";
import { stripMarkdown } from "@/lib/boards/markdown";

/** A displayed column in a List widget: id/name/kind + (for status/dropdown) options. */
export type DisplayColumn = {
  id: string;
  name: string;
  kind: string;
  options: ColumnOption[];
  /** Raw columns.settings jsonb — currency reads its ISO code from here. */
  settings?: unknown;
};

/** A rendered cell: text plus an optional pill color (status). */
export type CellDisplay = { text: string; color?: string };

const EMPTY: CellDisplay = { text: "—" };

/** Turn a jsonb cell value into a display by column kind. Missing/empty → "—". */
export function formatCell(column: DisplayColumn, value: unknown): CellDisplay {
  const v = (value ?? {}) as Record<string, unknown>;
  switch (column.kind) {
    case "text": {
      // Text columns hold Markdown (up to 20,000 chars) — this widget renders
      // a single-line table cell, so show the syntax-free preview
      // (`stripMarkdown`, the same helper the board's collapsed text cell
      // uses) rather than literal `**`/`-` syntax. The cell itself still gets
      // CSS `truncate` for overflow; this only removes the markup.
      if (typeof v.text !== "string" || !v.text) return EMPTY;
      const stripped = stripMarkdown(v.text);
      return stripped ? { text: stripped } : EMPTY;
    }
    case "numbers":
      return typeof v.n === "number" ? { text: String(v.n) } : EMPTY;
    case "currency":
      return typeof v.amount === "number"
        ? { text: formatCurrency(v.amount, currencyOf(column.settings)) }
        : EMPTY;
    case "date":
      return typeof v.date === "string" && v.date ? { text: v.date } : EMPTY;
    case "status": {
      const opt = column.options.find((o) => o.id === v.optionId);
      return opt ? { text: opt.label, color: opt.color } : EMPTY;
    }
    case "dropdown": {
      const ids = Array.isArray(v.optionIds) ? (v.optionIds as string[]) : [];
      const labels = ids
        .map((id) => column.options.find((o) => o.id === id)?.label)
        .filter((l): l is string => Boolean(l));
      return labels.length ? { text: labels.join(", ") } : EMPTY;
    }
    case "people": {
      const ids = Array.isArray(v.userIds) ? (v.userIds as string[]) : [];
      return ids.length ? { text: String(ids.length) } : EMPTY;
    }
    case "time_tracking":
      return EMPTY;
    default:
      return EMPTY;
  }
}
