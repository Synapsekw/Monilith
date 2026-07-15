import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandingViewSwitcher } from "./landing-view-switcher";

describe("LandingViewSwitcher", () => {
  it("renders four view tabs with Table selected by default", () => {
    render(<LandingViewSwitcher />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    const table = screen.getByRole("tab", { name: "Table" });
    expect(table).toHaveAttribute("aria-selected", "true");
    // Table view content is shown (a seeded task row).
    expect(screen.getByText("Q3 launch plan")).toBeInTheDocument();
  });

  it("swaps the shown view in client state when a tab is clicked", () => {
    render(<LandingViewSwitcher />);

    fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(screen.getByRole("tab", { name: "Timeline" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Table" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    // Timeline caption appears; table headers are gone.
    expect(screen.getByText("Realtime presence")).toBeInTheDocument();
    expect(screen.queryByText("Priority")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(screen.getByRole("tab", { name: "Calendar" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Calendar day-of-week header is present.
    expect(screen.getByText("Mon")).toBeInTheDocument();
  });
});
