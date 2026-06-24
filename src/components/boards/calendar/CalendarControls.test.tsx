import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CalendarControls } from "./CalendarControls";

const baseProps = {
  mode: "month" as const,
  label: "June 2026",
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onToday: vi.fn(),
  dateColumns: [
    { id: "d1", kind: "date", name: "Due Date", settings: {} },
  ] as never,
  activeDateColumnId: "d1",
  onDateColumnChange: vi.fn(),
};

describe("CalendarControls", () => {
  it("switches mode when a segment is clicked", () => {
    const onModeChange = vi.fn();
    render(<CalendarControls {...baseProps} onModeChange={onModeChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /week/i }));
    expect(onModeChange).toHaveBeenCalledWith("week");
  });

  it("renders the period label and the date-column picker", () => {
    render(<CalendarControls {...baseProps} onModeChange={vi.fn()} />);
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /date column/i }),
    ).toBeInTheDocument();
  });
});
