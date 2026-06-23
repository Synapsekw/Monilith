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

  it("collapses on toggle click, hiding the brand label", () => {
    render(<Sidebar navSlot={<div />} />);

    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));

    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    expect(screen.queryByText("MONOLITH")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /expand sidebar/i }),
    ).toBeInTheDocument();
  });

  it("toggles with the Cmd/Ctrl+\\ shortcut", () => {
    render(<Sidebar navSlot={<div />} />);

    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);

    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });
});
