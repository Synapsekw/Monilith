import type { ImportableKind, SynthOption } from "./types";
import type { ColumnKind } from "@/lib/validations/boards";
import { isHttpUrl } from "@/lib/validations/boards";
import type { Json } from "@/types/database.types";

/**
 * Render a stored cell value as a flat spreadsheet string.
 * Returns "" for blank/non-rendered kinds or any malformed input.
 * Never throws.
 */
export function cellToText(
  kind: ColumnKind,
  value: unknown,
  settings: unknown,
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

      // Export-structure-only kinds: always blank in v1
      case "people":
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
      return { text: trimmed };

    case "numbers": {
      const n = Number(trimmed);
      return Number.isFinite(n) ? { n } : null;
    }

    case "percent": {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return null;
      return { percent: Math.min(100, Math.max(0, n)) };
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
      // Prefer strict ISO YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return { date: trimmed };
      }
      // Fall back to any parseable date string
      const ts = Date.parse(trimmed);
      if (!Number.isNaN(ts)) {
        const iso = new Date(ts).toISOString().slice(0, 10);
        return { date: iso };
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
