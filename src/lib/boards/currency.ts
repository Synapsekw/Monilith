import { z } from "zod";

/**
 * Curated ISO 4217 codes offered by the currency column picker. Curated (not
 * the full ISO list) because Intl.NumberFormat throws on unknown codes — this
 * array is the validation boundary. Majors + full GCC + common regionals.
 * Extending = append here (schema, picker, and tests follow automatically).
 */
export const CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CHF",
  "CAD",
  "AUD",
  "NZD",
  "KWD",
  "AED",
  "SAR",
  "QAR",
  "BHD",
  "OMR",
  "EGP",
  "JOD",
  "INR",
  "PKR",
  "CNY",
  "HKD",
  "SGD",
  "KRW",
  "THB",
  "MYR",
  "IDR",
  "PHP",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "TRY",
  "BRL",
  "MXN",
  "ARS",
  "CLP",
  "COP",
  "ZAR",
  "NGN",
  "KES",
  "MAD",
  "ILS",
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];
export const currencyCodeSchema = z.enum(CURRENCY_CODES);

/**
 * Pinned "Common" picker group (spec §5.2): GCC first (the user base), then
 * the global majors — visible with zero typing when the picker opens.
 */
export const COMMON_CURRENCY_CODES = [
  "AED",
  "KWD",
  "SAR",
  "QAR",
  "BHD",
  "OMR",
  "USD",
  "EUR",
  "GBP",
] as const satisfies readonly CurrencyCode[];

export function isCurrencyCode(code: unknown): code is CurrencyCode {
  return (
    typeof code === "string" &&
    (CURRENCY_CODES as readonly string[]).includes(code)
  );
}

// Cells render in a virtualized hot path — memoize one formatter per code.
const formatters = new Map<CurrencyCode, Intl.NumberFormat>();
function formatterFor(code: CurrencyCode): Intl.NumberFormat {
  let f = formatters.get(code);
  if (!f) {
    f = new Intl.NumberFormat(undefined, { style: "currency", currency: code });
    formatters.set(code, f);
  }
  return f;
}

/**
 * Format an amount in the viewer's locale ("$1,234.50", "KD 1,234.500").
 * Accepts a plain string code so callers can pass raw jsonb settings; an
 * unknown code degrades to "CODE 12.00" instead of throwing (a malformed
 * stored row must never crash a board render).
 */
export function formatCurrency(amount: number, code: string): string {
  if (!isCurrencyCode(code)) return `${code} ${amount.toFixed(2)}`;
  return formatterFor(code).format(amount);
}

/**
 * formatToParts variant of formatCurrency — the CurrencyAmount renderer swaps
 * the `currency` part for the U+20C3 dirham glyph (spec §5.4) while every
 * digit/separator part stays exactly what Intl produced.
 */
export function formatCurrencyParts(
  amount: number,
  code: CurrencyCode,
): Intl.NumberFormatPart[] {
  return formatterFor(code).formatToParts(amount);
}

/**
 * Whether AED amounts under these column settings show the new UAE dirham
 * sign (U+20C3, drawn as our own glyph until fonts ship Unicode 18.0).
 * Per-column display choice, DEFAULT ON: absent/omitted means enabled.
 */
export function dirhamSignEnabled(settings: unknown): boolean {
  if (currencyOf(settings) !== "AED") return false;
  const flag = (settings as { dirham_sign?: unknown } | null)?.dirham_sign;
  return flag !== false;
}

/** Minor-unit decimals for a code (USD→2, JPY→0, KWD→3) via Intl. */
export function currencyDecimals(code: CurrencyCode): number {
  return formatterFor(code).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Round an entered amount to the code's minor units (commit-time normalization). */
export function roundToCurrency(amount: number, code: CurrencyCode): number {
  const factor = 10 ** currencyDecimals(code);
  return Math.round(amount * factor) / factor;
}

let displayNames: Intl.DisplayNames | null = null;
/** Picker label, e.g. "KWD — Kuwaiti Dinar". Falls back to the bare code. */
export function currencyLabel(code: CurrencyCode): string {
  try {
    displayNames ??= new Intl.DisplayNames(undefined, { type: "currency" });
    const name = displayNames.of(code);
    return name && name !== code ? `${code} — ${name}` : code;
  } catch {
    return code;
  }
}

/**
 * Read a currency column's code from its raw settings jsonb. USD fallback
 * keeps a malformed/legacy row renderable (defense in depth; the settings
 * schema requires a valid code at every write boundary).
 */
export function currencyOf(settings: unknown): CurrencyCode {
  const c = (settings as { currency?: unknown } | null)?.currency;
  return isCurrencyCode(c) ? c : "USD";
}
