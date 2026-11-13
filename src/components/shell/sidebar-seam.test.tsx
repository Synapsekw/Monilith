import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SidebarSeam } from "./sidebar-seam";
import { useUIStore } from "@/stores/ui";

beforeEach(() => {
  act(() =>
    useUIStore.setState({ sidebarCollapsed: false, hasHydrated: true }),
  );
});

describe("SidebarSeam", () => {
  it("shows a panel glyph for the sidebar, not a direction arrow", () => {
    render(<SidebarSeam />);
    const svg = screen
      .getByRole("button", { name: /collapse sidebar/i })
      .querySelector("svg")!;
    expect(svg).toHaveAttribute("data-panel-glyph", "left");
    expect(svg).toHaveAttribute("data-state", "open");
  });

  it("folds the rail and empties the glyph", () => {
    render(<SidebarSeam />);
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    const svg = screen
      .getByRole("button", { name: /expand sidebar/i })
      .querySelector("svg")!;
    expect(svg).toHaveAttribute("data-state", "closed");
  });
});
