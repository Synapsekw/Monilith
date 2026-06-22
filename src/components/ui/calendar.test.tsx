import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Calendar } from "./calendar";

// June 1, 2026 is a Monday — a clean fixed month so outside days never collide
// with the "15" we query (May/July 15 fall outside the rendered weeks).
const JUNE_2026 = new Date(2026, 5, 1);

describe("Calendar", () => {
  it("renders an accessible month grid for the given month", () => {
    render(<Calendar mode="single" defaultMonth={JUNE_2026} />);

    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("calls onSelect with the clicked day", async () => {
    const onSelect = vi.fn();
    render(
      <Calendar mode="single" defaultMonth={JUNE_2026} onSelect={onSelect} />,
    );

    await userEvent.click(screen.getByText("15"));

    expect(onSelect).toHaveBeenCalled();
    const picked = onSelect.mock.calls[0]?.[0] as Date;
    expect(picked.getFullYear()).toBe(2026);
    expect(picked.getMonth()).toBe(5);
    expect(picked.getDate()).toBe(15);
  });

  it("marks the selected day with aria-selected", () => {
    render(
      <Calendar
        mode="single"
        defaultMonth={JUNE_2026}
        selected={new Date(2026, 5, 15)}
      />,
    );

    const gridcell = screen.getByText("15").closest('[role="gridcell"]');
    expect(gridcell).toHaveAttribute("aria-selected", "true");
  });

  it("navigates to the next month via the nav button", async () => {
    render(<Calendar mode="single" defaultMonth={JUNE_2026} />);

    await userEvent.click(screen.getByRole("button", { name: /next month/i }));

    expect(screen.getByText("July 2026")).toBeInTheDocument();
  });
});
