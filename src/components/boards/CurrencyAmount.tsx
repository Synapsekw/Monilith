"use client";

import {
  currencyOf,
  dirhamSignEnabled,
  formatCurrency,
  formatCurrencyParts,
} from "@/lib/boards/currency";

/**
 * The new UAE dirham sign (U+20C3, Unicode 18.0) as an inline SVG: no
 * released font can render the character yet (accepted by the UTC July 2025;
 * ships September 2026), so we draw the official design — a capital D crossed
 * by two horizontal bars — ourselves. 1em box, currentColor, reads as "AED"
 * to assistive tech and copy/paste. Swap for the literal character once OS
 * fonts ship it (spec §9.6).
 */
export function DirhamSign({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label="AED"
      className={className}
      style={{ height: "1em", width: "0.9em", verticalAlign: "-0.08em" }}
      fill="none"
      stroke="currentColor"
      strokeWidth={9}
    >
      {/* Capital D */}
      <path d="M25 8 h18 a34 42 0 0 1 0 84 h-18 z" />
      {/* Two crossbars, extending left of the stem per the official mark */}
      <line x1="8" y1="40" x2="78" y2="40" />
      <line x1="8" y1="62" x2="78" y2="62" />
    </svg>
  );
}

/**
 * THE way to print a currency amount in React surfaces (cell, editor prefix,
 * footer, rollup, kanban, dialog). Number formatting is always Intl's; only
 * the AED symbol presentation is custom (spec §5.4). Plain-text consumers
 * keep using formatCurrency() and therefore keep "AED".
 */
export function CurrencyAmount({
  amount,
  settings,
  className,
}: {
  amount: number;
  settings: unknown;
  className?: string;
}) {
  const code = currencyOf(settings);
  if (!dirhamSignEnabled(settings)) {
    return (
      <span data-testid="currency-amount" className={className}>
        {formatCurrency(amount, code)}
      </span>
    );
  }
  return (
    <span data-testid="currency-amount" className={className}>
      {formatCurrencyParts(amount, code).map((part, i) =>
        part.type === "currency" ? (
          <DirhamSign key={i} className="inline-block" />
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </span>
  );
}
