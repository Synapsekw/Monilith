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

describe("Sidebar", () => {
  it("renders the brand and nav labels when expanded", () => {
    render(<Sidebar boards={[]} workspaces={[]} dashboards={[]} />);
    expect(screen.getByText("MONOLITH")).toBeInTheDocument();
    expect(screen.getByText("Dashboards")).toBeInTheDocument();
  });

  it("collapses on toggle click, hiding the labels", () => {
    render(<Sidebar boards={[]} workspaces={[]} dashboards={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));

    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    expect(screen.queryByText("MONOLITH")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboards")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dashboards" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /expand sidebar/i }),
    ).toBeInTheDocument();
  });

  it("toggles with the Cmd/Ctrl+\\ shortcut", () => {
    render(<Sidebar boards={[]} workspaces={[]} dashboards={[]} />);

    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);

    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });
});
