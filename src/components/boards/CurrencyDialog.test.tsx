import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CurrencyDialog } from "@/components/boards/CurrencyDialog";

const column = {
  id: "c1",
  kind: "currency",
  name: "Budget",
  settings: { currency: "USD", summary_aggregation: "sum" },
} as never;

describe("CurrencyDialog", () => {
  beforeEach(() => localStorage.clear());

  it("saves the picked code, preserving other settings", async () => {
    const onSave = vi.fn();
    render(<CurrencyDialog column={column} onSave={onSave} />);
    await userEvent.type(
      screen.getByPlaceholderText("Search currencies…"),
      "kuwait",
    );
    // KWD appears in both the Common and All groups — either applies the same.
    await userEvent.click((await screen.findAllByText(/KWD/))[0]);
    expect(onSave).toHaveBeenCalledWith({
      currency: "KWD",
      summary_aggregation: "sum",
    });
    expect(onSave).toHaveBeenCalledTimes(1); // instant apply — one action, no Save button
  });

  it("autofocuses the search input (search-first)", () => {
    render(<CurrencyDialog column={column} onSave={vi.fn()} />);
    expect(screen.getByPlaceholderText("Search currencies…")).toHaveFocus();
  });

  it("pins Common (GCC + majors) with zero typing", () => {
    render(<CurrencyDialog column={column} onSave={vi.fn()} />);
    expect(screen.getByText("Common")).toBeInTheDocument();
    // AED/KWD visible without any search input
    expect(screen.getAllByText(/AED/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/KWD/).length).toBeGreaterThan(0);
  });

  it("keyboard path: type then Enter selects the top hit (≤2 interactions)", async () => {
    const onSave = vi.fn();
    render(<CurrencyDialog column={column} onSave={onSave} />);
    await userEvent.keyboard("dirham{Enter}");
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "AED" }),
    );
  });

  it("remembers recent picks across opens (localStorage)", async () => {
    const { unmount } = render(
      <CurrencyDialog column={column} onSave={vi.fn()} />,
    );
    await userEvent.type(
      screen.getByPlaceholderText("Search currencies…"),
      "kuwait",
    );
    await userEvent.click((await screen.findAllByText(/KWD/))[0]);
    unmount();
    render(<CurrencyDialog column={column} onSave={vi.fn()} />);
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("states that amounts are not converted", () => {
    render(<CurrencyDialog column={column} onSave={vi.fn()} />);
    expect(screen.getByText("Amounts are not converted.")).toBeInTheDocument();
  });
});
