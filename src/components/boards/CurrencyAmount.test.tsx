import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CurrencyAmount } from "@/components/boards/CurrencyAmount";
import { formatCurrency } from "@/lib/boards/currency";

describe("CurrencyAmount", () => {
  it("renders the dirham glyph for AED by default", () => {
    render(<CurrencyAmount amount={1234.5} settings={{ currency: "AED" }} />);
    // glyph present, accessible as "AED"
    expect(screen.getByRole("img", { name: "AED" })).toBeInTheDocument();
    // digits/grouping stay exactly Intl's (strip the symbol part for comparison)
    expect(screen.getByTestId("currency-amount").textContent).toContain(
      "1,234",
    );
  });
  it("respects the per-column opt-out", () => {
    render(
      <CurrencyAmount
        amount={5}
        settings={{ currency: "AED", dirham_sign: false }}
      />,
    );
    expect(screen.queryByRole("img", { name: "AED" })).toBeNull();
    expect(screen.getByTestId("currency-amount").textContent).toBe(
      formatCurrency(5, "AED"),
    );
  });
  it("never shows the glyph for non-AED codes", () => {
    render(<CurrencyAmount amount={5} settings={{ currency: "KWD" }} />);
    expect(screen.queryByRole("img", { name: "AED" })).toBeNull();
    expect(screen.getByTestId("currency-amount").textContent).toBe(
      formatCurrency(5, "KWD"),
    );
  });
});
