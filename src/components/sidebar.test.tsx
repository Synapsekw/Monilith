import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "./sidebar";
import { useUIStore } from "@/stores/ui";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({}),
}));

beforeEach(() => {
  useUIStore.setState({ sidebarCollapsed: false, hasHydrated: true });
});

describe("Sidebar frame", () => {
  it("renders the brand and the provided navSlot", () => {
    render(<Sidebar navSlot={<div>NAV_SLOT_MARKER</div>} />);
    expect(screen.getByText("MONOLITH")).toBeInTheDocument();
    expect(screen.getByText("NAV_SLOT_MARKER")).toBeInTheDocument();
  });

  it("exposes data-collapsed for slot CSS / store-driven compaction", () => {
    useUIStore.setState({ sidebarCollapsed: true, hasHydrated: true });
    const { container } = render(<Sidebar navSlot={<div />} />);
    expect(container.querySelector("aside")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
  });

  it("hides the brand label when the store says collapsed", () => {
    useUIStore.setState({ sidebarCollapsed: true, hasHydrated: true });
    render(<Sidebar navSlot={<div />} />);
    expect(screen.queryByText("MONOLITH")).not.toBeInTheDocument();
  });

  it("carries no collapse control of its own — that is the card's seam", () => {
    // The chevron used to live in the brand row, far from the edge it moved and
    // asymmetric with the dock's. `SidebarSeam` owns it now; the rail keeps only
    // the keyboard shortcut. Guarding the absence is what stops it drifting back.
    render(<Sidebar navSlot={<div />} />);
    expect(
      screen.queryByRole("button", { name: /collapse sidebar/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /expand sidebar/i }),
    ).not.toBeInTheDocument();
  });

  it("toggles with the Cmd/Ctrl+\\ shortcut", () => {
    render(<Sidebar navSlot={<div />} />);

    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);

    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it("paints nothing — it shows the wash through", () => {
    const { container } = render(<Sidebar navSlot={<div>NAV</div>} />);
    const aside = container.querySelector("aside") as HTMLElement;
    expect(aside.className).not.toMatch(/\bbg-sidebar\b/);
    expect(aside.className).not.toMatch(/\bborder-r\b/);
  });
});
