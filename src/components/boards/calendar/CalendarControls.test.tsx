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

  it("gives the prev/next nav buttons a ≥44px touch target on coarse pointers", () => {
    render(<CalendarControls {...baseProps} onModeChange={vi.fn()} />);
    const prev = screen.getByRole("button", { name: /previous period/i });
    const next = screen.getByRole("button", { name: /next period/i });
    for (const el of [prev, next]) {
      expect(el.className).toContain("pointer-coarse:size-11");
    }
  });

  it("gives the Today button and mode tabs a ≥44px touch height on coarse pointers", () => {
    render(<CalendarControls {...baseProps} onModeChange={vi.fn()} />);
    const today = screen.getByRole("button", { name: /^today$/i });
    expect(today.className).toContain("pointer-coarse:min-h-11");
    for (const name of ["month", "week", "agenda"]) {
      const tab = screen.getByRole("tab", { name: new RegExp(name, "i") });
      expect(tab.className).toContain("pointer-coarse:min-h-11");
    }
  });
});
