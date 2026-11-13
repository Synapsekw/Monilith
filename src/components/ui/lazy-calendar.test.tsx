import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";

import { LazyCalendar, preloadCalendar } from "./lazy-calendar";

const JUNE_10 = new Date(2026, 5, 10);

describe("LazyCalendar", () => {
  // MUST stay the first test that renders LazyCalendar: React.lazy caches the
  // resolved module for the life of this test module, so only the first render
  // ever sees the pending (fallback) state.
  it("shows a calendar-sized, focusable placeholder, then hands focus to the day grid", async () => {
    render(
      <LazyCalendar
        mode="single"
        autoFocus
        defaultMonth={JUNE_10}
        selected={JUNE_10}
      />,
    );

    // Chunk not resolved yet: no grid, a fixed-footprint placeholder instead.
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    const fallback = screen.getByRole("status", { name: "Loading calendar" });
    expect(fallback).toHaveClass("h-[312px]", "w-[260px]");
    // Tabbable on purpose — it is what a Radix popover focuses on open, instead
    // of a neighbouring button. Simulate that here.
    expect(fallback).toHaveAttribute("tabindex", "0");
    fallback.focus();
    expect(fallback).toHaveFocus();

    // Generous timeout: this is the cold import of react-day-picker + date-fns.
    const grid = await screen.findByRole("grid", {}, { timeout: 10_000 });
    expect(
      screen.queryByRole("status", { name: "Loading calendar" }),
    ).not.toBeInTheDocument();
    // `autoFocus` survives the lazy boundary: focus lands on the selected day.
    await waitFor(() =>
      expect(grid).toContainElement(document.activeElement as HTMLElement),
    );
    expect(document.activeElement).toHaveTextContent("10");
  });

  it("forwards props to the real Calendar (selection works)", async () => {
    const onSelect = vi.fn();
    render(
      <LazyCalendar mode="single" defaultMonth={JUNE_10} onSelect={onSelect} />,
    );
    await userEvent.click(await screen.findByText("15"));
    const picked = onSelect.mock.calls[0]?.[0] as Date;
    expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual(
      [2026, 5, 15],
    );
  });

  it("preloadCalendar is safe to call repeatedly", () => {
    expect(() => {
      preloadCalendar();
      preloadCalendar();
    }).not.toThrow();
  });

  // The whole point of the wrapper: the cell modules that sit in the board
  // table's first-load graph must not import the calendar statically again.
  it.each([
    "src/components/boards/cells/TimeTrackingCell.tsx",
    "src/components/boards/cells/editors/index.tsx",
    "src/components/ui/lazy-calendar.tsx",
  ])("%s has no static import of the calendar or react-day-picker", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/^import \{[^}]*\} from "@\/components\/ui\/calendar"/m);
    expect(src).not.toMatch(/from "react-day-picker"/);
  });
});
