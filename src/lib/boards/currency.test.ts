import { describe, expect, it } from "vitest";
import {
  COMMON_CURRENCY_CODES,
  CURRENCY_CODES,
  currencyDecimals,
  currencyLabel,
  currencyOf,
  dirhamSignEnabled,
  formatCurrency,
  formatCurrencyParts,
  isCurrencyCode,
  roundToCurrency,
} from "@/lib/boards/currency";

describe("currencyDecimals", () => {
  it("knows minor units per code", () => {
    expect(currencyDecimals("USD")).toBe(2);
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("KWD")).toBe(3);
  });
});

describe("roundToCurrency", () => {
  it("rounds to the code's minor units", () => {
    expect(roundToCurrency(10.126, "USD")).toBe(10.13);
    expect(roundToCurrency(100.5, "JPY")).toBe(101);
    expect(roundToCurrency(1.23456, "KWD")).toBe(1.235);
    expect(roundToCurrency(-2.005, "JPY")).toBe(-2);
  });
});

describe("formatCurrency", () => {
  it("matches Intl currency-style output for known codes", () => {
    const oracle = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
    });
    expect(formatCurrency(1234.5, "USD")).toBe(oracle.format(1234.5));
  });
  it("never throws on an unknown code — deterministic fallback", () => {
    expect(formatCurrency(5, "ZZZ")).toBe("ZZZ 5.00");
  });
});

describe("catalogue + guards", () => {
  it("contains the majors and full GCC set", () => {
    for (const c of [
      "USD",
      "EUR",
      "GBP",
      "JPY",
      "KWD",
      "AED",
      "SAR",
      "QAR",
      "BHD",
      "OMR",
    ])
      expect(CURRENCY_CODES).toContain(c);
  });
  it("isCurrencyCode narrows correctly", () => {
    expect(isCurrencyCode("KWD")).toBe(true);
    expect(isCurrencyCode("ZZZ")).toBe(false);
    expect(isCurrencyCode(42)).toBe(false);
  });
  it("currencyLabel prefixes the code", () => {
    expect(currencyLabel("USD").startsWith("USD")).toBe(true);
  });
  it("currencyOf reads settings with a USD fallback", () => {
    expect(currencyOf({ currency: "KWD" })).toBe("KWD");
    expect(currencyOf({ currency: "nope" })).toBe("USD");
    expect(currencyOf(null)).toBe("USD");
  });
  it("pins GCC + majors in the common group", () => {
    expect(COMMON_CURRENCY_CODES).toEqual([
      "AED",
      "KWD",
      "SAR",
      "QAR",
      "BHD",
      "OMR",
      "USD",
      "EUR",
      "GBP",
    ]);
  });
});

describe("formatCurrencyParts", () => {
  it("exposes a currency part the renderer can swap", () => {
    const parts = formatCurrencyParts(1234.5, "AED");
    expect(parts.some((p) => p.type === "currency")).toBe(true);
    expect(parts.map((p) => p.value).join("")).toBe(
      formatCurrency(1234.5, "AED"),
    );
  });
});

describe("dirhamSignEnabled", () => {
  it("defaults ON for AED, respects the opt-out, never for other codes", () => {
    expect(dirhamSignEnabled({ currency: "AED" })).toBe(true);
    expect(dirhamSignEnabled({ currency: "AED", dirham_sign: false })).toBe(
      false,
    );
    expect(dirhamSignEnabled({ currency: "KWD" })).toBe(false);
    expect(dirhamSignEnabled(null)).toBe(false);
  });
});
