import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterBuilder, type FilterColumn } from "./FilterBuilder";
import type { ListFilter } from "@/lib/validations/dashboards";

const COLS: FilterColumn[] = [
  {
    id: "c-status",
    name: "Status",
    kind: "status",
    options: [{ id: "o1", label: "Done", color: "#16a34a" }],
  },
  { id: "c-num", name: "Score", kind: "numbers", options: [] },
];
const EMPTY: ListFilter = { combinator: "and", conditions: [] };

describe("FilterBuilder", () => {
  it("adds a condition when '+ Add condition' is clicked", () => {
    const onChange = vi.fn();
    render(<FilterBuilder columns={COLS} value={EMPTY} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add condition/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: [expect.objectContaining({ columnId: "c-status" })],
      }),
    );
  });

  it("offers only the selected column kind's operators", () => {
    const value: ListFilter = {
      combinator: "and",
      conditions: [{ columnId: "c-num", operator: "num_eq", value: "" }],
    };
    render(<FilterBuilder columns={COLS} value={value} onChange={vi.fn()} />);
    const opSelect = screen.getByLabelText(/operator/i);
    const opts = Array.from(opSelect.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(opts).toContain(">");
    expect(opts).not.toContain("contains");
  });

  it("hides the value control for is_empty", () => {
    const value: ListFilter = {
      combinator: "and",
      conditions: [{ columnId: "c-status", operator: "is_empty" }],
    };
    render(<FilterBuilder columns={COLS} value={value} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(/value/i)).toBeNull();
  });

  it("removes a condition", () => {
    const onChange = vi.fn();
    const value: ListFilter = {
      combinator: "and",
      conditions: [{ columnId: "c-status", operator: "is_empty" }],
    };
    render(<FilterBuilder columns={COLS} value={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove condition/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ conditions: [] }),
    );
  });
});
