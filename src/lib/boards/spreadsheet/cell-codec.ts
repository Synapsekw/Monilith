import type { ImportableKind, SynthOption } from "./types";
import type { ColumnKind } from "@/lib/validations/boards";
import { isHttpUrl } from "@/lib/validations/boards";
import type { Json } from "@/types/database.types";

/**
 * Same lead-character set the CSV export guard (`CSV_FORMULA_LEAD_RE` in
 * `export-workbook.ts`) defuses with a leading `'`. Duplicated (not
 * imported) because export-workbook is exceljs-facing while this module is
 * pure/import-facing — kept in sync deliberately; if the export guard's
 * character set changes, this must change with it.
 */
const FORMULA_LEAD_RE = /^[=+\-@\t\r]/;

/**
 * Undo the CSV formula-injection guard's leading `'` on import — and
 * nothing else. `guardCsvCell` in export-workbook.ts prefixes a `'` to any
 * string cell whose text starts with a formula-trigger character (`=+-@`,
 * tab, CR) so a spreadsheet app shows it as literal text. Without this
 * inverse, exporting a board and re-importing it corrupts every Markdown
 * bullet/heading (`- item` → `'- item`) and compounds on repeated
 * round-trips. Only strips the quote when what FOLLOWS it is itself a
 * formula-lead character — so a genuine leading apostrophe the user typed
 * (`'twas the night`) is left completely untouched, since `t` is not a
 * formula-lead character.
 */
function unquoteCsvFormulaGuard(text: string): string {
  if (text[0] !== "'") return text;
  const rest = text.slice(1);
  return FORMULA_LEAD_RE.test(rest) ? rest : text;
}

/**
 * Render a stored cell value as a flat spreadsheet string.
 * Returns "" for blank/non-rendered kinds or any malformed input.
 * Never throws.
 */
export function cellToText(
  kind: ColumnKind,
  value: unknown,
  settings: unknown,
  /**
   * Resolve a people-column user id to a display name. Returns null when the
   * name can't be resolved (the id is then omitted from the output). When
   * absent, people columns render blank — the v1 default.
   */
  resolvePeopleName?: (userId: string) => string | null,
): string {
  try {
    if (value == null || typeof value !== "object") return "";

    const v = value as Record<string, unknown>;

    switch (kind) {
      case "text":
        return typeof v.text === "string" ? v.text : "";

      case "numbers":
        return typeof v.n === "number" ? String(v.n) : "";

      case "percent":
        return typeof v.percent === "number" ? String(v.percent) : "";

      // Raw number keeps the export re-importable (Excel/CSV); locale
      // formatting is a display concern, not a data-exchange one.
      case "currency":
        return typeof v.amount === "number" ? String(v.amount) : "";

      case "rating":
        return typeof v.rating === "number" ? String(v.rating) : "";

      case "phone":
        return typeof v.phone === "string" ? v.phone : "";

      case "email":
        return typeof v.email === "string" ? v.email : "";

      case "link":
        if (typeof v.text === "string" && v.text) return v.text;
        return typeof v.url === "string" ? v.url : "";

      case "date":
        return typeof v.date === "string" ? v.date : "";

      case "checkbox":
        return typeof v.checked === "boolean"
          ? v.checked
            ? "TRUE"
            : "FALSE"
          : "";

      case "status": {
        if (v.optionId == null) return "";
        const s = settings as {
          options?: Array<{ id: string; label: string }>;
        } | null;
        if (!s || !Array.isArray(s.options)) return "";
        const opt = s.options.find((o) => o.id === v.optionId);
        return opt ? opt.label : "";
      }

      case "dropdown": {
        const ids = v.optionIds;
        if (!Array.isArray(ids) || ids.length === 0) return "";
        const s = settings as {
          options?: Array<{ id: string; label: string }>;
        } | null;
        if (!s || !Array.isArray(s.options)) return "";
        const labels = (ids as unknown[])
          .map((id) => {
            const opt = s.options!.find((o) => o.id === id);
            return opt ? opt.label : null;
          })
          .filter((l): l is string => l !== null);
        return labels.join(", ");
      }

      case "people": {
        // Resolve assignee display names when a resolver is supplied; otherwise
        // blank (v1 default). Unresolvable ids are dropped; blank when none.
        if (!resolvePeopleName) return "";
        const ids = v.userIds;
        if (!Array.isArray(ids) || ids.length === 0) return "";
        const names = (ids as unknown[])
          .map((id) => (typeof id === "string" ? resolvePeopleName(id) : null))
          .filter((n): n is string => typeof n === "string" && n !== "");
        return names.join(", ");
      }

      case "priority":
        // STORED level only — the derived auto-critical state deliberately
        // does not export (spec open question 5).
        return v.level === "critical"
          ? "Critical"
          : v.level === "normal"
            ? "Normal"
            : "";

      // Export-structure-only kinds: always blank in v1
      case "relation":
      case "mirror":
      case "files":
      case "time_tracking":
        return "";

      default:
        return "";
    }
  } catch {
    return "";
  }
}

/** A cell value ready for exceljs `addRow`: real numbers for numbers/percent/
 *  currency, the flat `cellToText` string otherwise. Never throws. */
export type ExcelCellValue = string | number;

export function cellToExcelValue(
  kind: ColumnKind,
  value: unknown,
  settings: unknown,
  resolvePeopleName?: (userId: string) => string | null,
): ExcelCellValue {
  const text = cellToText(kind, value, settings, resolvePeopleName);
  if (
    (kind === "numbers" || kind === "percent" || kind === "currency") &&
    text !== ""
  ) {
    const n = Number(text);
    if (Number.isFinite(n)) return n;
  }
  return text;
}

/**
 * Parse a locale-decorated numeric string into a plain number, tolerant of
 * both US (`1,234.56`) and EU (`1.234,56`) grouping/decimal conventions plus
 * currency symbols, spaces and accounting-style parenthesised negatives.
 * Returns `null` for anything without a digit (so a genuinely-unparseable
 * non-empty cell is surfaced as invalid rather than silently coerced).
 *
 * Decimal-separator resolution:
 * - Both `.` and `,` present → the **right-most** one is the decimal point,
 *   the other is a grouping separator (`1.234,56`→1234.56, `1,234.56`→1234.56).
 * - Only `,` present → decimal **iff** there is exactly one comma followed by
 *   1–2 digits (`1,5`→1.5, `1,56`→1.56); otherwise it's grouping
 *   (`1,234`→1234, `1,234,567`→1234567).
 * - Only `.` present → treated as the decimal point (JS/US native), except
 *   multiple dots which are grouping (`1.234.567`→1234567). A lone
 *   `1.234` therefore parses as 1.234, not 1234 — without a decimal-comma or
 *   currency-locale signal a bare dot is the standard decimal point; genuine
 *   EU thousands appear as `1.234,00` / `€1.234` and resolve via the branches
 *   above.
 */
export function parseNumericLoose(raw: string): number | null {
  let s = raw.trim();
  if (s === "") return null;

  // Accounting negative: "(500)" → -500.
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1];
  }

  // Drop currency symbols, spaces, and any other decoration — keep only
  // digits, separators and signs.
  s = s.replace(/[^\d.,+-]/g, "");

  // Pull a single leading sign, then discard any stray signs.
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  s = s.replace(/[+-]/g, "");
  if (!/\d/.test(s)) return null;

  const dotCount = (s.match(/\./g) ?? []).length;
  const commaCount = (s.match(/,/g) ?? []).length;

  let normalized: string;
  if (dotCount > 0 && commaCount > 0) {
    if (s.lastIndexOf(".") > s.lastIndexOf(",")) {
      normalized = s.replace(/,/g, ""); // dot decimal, comma grouping
    } else {
      normalized = s.replace(/\./g, "").replace(",", "."); // comma decimal
    }
  } else if (commaCount > 0) {
    const afterLast = s.length - s.lastIndexOf(",") - 1;
    const commaIsDecimal = commaCount === 1 && afterLast >= 1 && afterLast <= 2;
    normalized = commaIsDecimal ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (dotCount > 1) {
    normalized = s.replace(/\./g, ""); // repeated dots → grouping
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Parse an import date string to a canonical `YYYY-MM-DD`, or `null` when it
 * isn't a date shape we can resolve **unambiguously**. ISO dates/datetimes and
 * `YYYY/MM/DD` are taken as-is. For `dd/mm/yyyy`-vs-`mm/dd/yyyy` slash dates the
 * order is inferred only when a component exceeds 12 (`25/12/2024`→DD/MM,
 * `12/25/2024`→MM/DD); a genuinely ambiguous value where both are ≤ 12
 * (e.g. `03/04/2024`) returns `null` instead of silently guessing month-first.
 */
export function parseImportDate(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;

  // ISO date or datetime — canonical, unambiguous.
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(t)) {
    const ts = Date.parse(t);
    if (Number.isNaN(ts)) return null;
    return new Date(ts).toISOString().slice(0, 10);
  }

  // YYYY/MM/DD — year-first, unambiguous.
  const ymd = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(t);
  if (ymd) return buildIsoDate(+ymd[1], +ymd[2], +ymd[3]);

  // dd/mm/yyyy or mm/dd/yyyy — disambiguate by a component > 12.
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (dmy) {
    const a = +dmy[1];
    const b = +dmy[2];
    const y = +dmy[3];
    if (a > 12 && b >= 1 && b <= 12) return buildIsoDate(y, b, a); // DD/MM
    if (b > 12 && a >= 1 && a <= 12) return buildIsoDate(y, a, b); // MM/DD
    return null; // both ≤ 12 (ambiguous) or both > 12 (invalid)
  }

  return null;
}

/** Validate a Y-M-D triple against the real calendar and format it as ISO. */
function buildIsoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/**
 * Parse a raw spreadsheet string into a cell value Json for an importable kind.
 * Returns null when empty/invalid. Never throws.
 */
export function textToCell(
  kind: ImportableKind,
  raw: string,
  options: SynthOption[],
): Json | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  switch (kind) {
    case "text":
      return { text: unquoteCsvFormulaGuard(trimmed) };

    case "numbers": {
      const n = parseNumericLoose(trimmed);
      return n !== null ? { n } : null;
    }

    case "percent": {
      // Tolerate a trailing "%" and locale grouping/decimals ("12,5%" → 12.5).
      const n = parseNumericLoose(trimmed);
      if (n === null) return null;
      return { percent: Math.min(100, Math.max(0, n)) };
    }

    case "currency": {
      // Accept symbol/grouping-decorated money in either US or EU convention:
      // "$1,234.50" → 1234.5, "€1.234,56" → 1234.56, "(500)" → -500.
      const n = parseNumericLoose(trimmed);
      return n !== null ? { amount: n } : null;
    }

    case "rating": {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return null;
      return { rating: Math.min(5, Math.max(1, Math.round(n))) };
    }

    case "phone":
      return { phone: trimmed };

    case "email":
      return trimmed.includes("@") ? { email: trimmed } : null;

    case "link":
      return isHttpUrl(trimmed) ? { url: trimmed } : null;

    case "date": {
      // ISO and unambiguous slash dates (see parseImportDate). Ambiguous
      // dd/mm-vs-mm/dd values return null here rather than silently defaulting
      // to month-first, so they surface as unparseable instead of wrong.
      const iso = parseImportDate(trimmed);
      if (iso) return { date: iso };
      // Non-ISO, non-slash prose ("January 15, 2024") stays supported via
      // Date.parse. The `/` guard keeps slash dates out of this branch so they
      // can never be silently re-interpreted month-first.
      if (!trimmed.includes("/")) {
        const ts = Date.parse(trimmed);
        if (!Number.isNaN(ts)) {
          return { date: new Date(ts).toISOString().slice(0, 10) };
        }
      }
      return null;
    }

    case "checkbox": {
      const lower = trimmed.toLowerCase();
      if (["true", "yes", "✓", "x", "1"].includes(lower))
        return { checked: true };
      if (["false", "no", "0"].includes(lower)) return { checked: false };
      return null;
    }

    case "status": {
      const lower = trimmed.toLowerCase();
      const opt = options.find((o) => o.label.toLowerCase() === lower);
      return opt ? { optionId: opt.id } : null;
    }

    case "priority": {
      const lower = trimmed.toLowerCase();
      if (lower === "critical") return { level: "critical" };
      if (lower === "normal") return { level: "normal" };
      return null;
    }

    case "dropdown": {
      const tokens = trimmed
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t !== "");
      const matched: string[] = [];
      for (const token of tokens) {
        const lower = token.toLowerCase();
        const opt = options.find((o) => o.label.toLowerCase() === lower);
        if (opt) matched.push(opt.id);
      }
      return matched.length > 0 ? { optionIds: matched } : null;
    }

    default:
      return null;
  }
}
