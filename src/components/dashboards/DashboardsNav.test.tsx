import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { DashboardsNav } from "./DashboardsNav";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUIStore } from "@/stores/ui";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";

const mockUseParams = vi.fn(() => ({}) as Record<string, string>);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useParams: () => mockUseParams(),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/dashboards/actions", () => ({
  createDashboard: vi.fn(),
}));
vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: vi.fn(() => false),
}));

beforeEach(() => {
  useUIStore.setState({ newDashboardOpen: false });
  vi.mocked(useCoarsePointer).mockReturnValue(false);
  mockUseParams.mockReturnValue({});
});

describe("DashboardsNav", () => {
  const activeWorkspaceId = "ws1";

  it("opens the create dialog when the newDashboardOpen store flag is set", async () => {
    render(
      <DashboardsNav dashboards={[]} activeWorkspaceId={activeWorkspaceId} />,
    );
    expect(
      screen.queryByText("Give your dashboard a name to get started."),
    ).toBeNull();
    useUIStore.setState({ newDashboardOpen: true });
    await waitFor(() =>
      expect(
        screen.getByText("Give your dashboard a name to get started."),
      ).toBeInTheDocument(),
    );
  });

  it("offers blank and AI options from the + menu, and blank opens the create dialog", async () => {
    render(
      <DashboardsNav dashboards={[]} activeWorkspaceId={activeWorkspaceId} />,
    );

    // The standalone AI icon is gone — generation lives inside the + menu now.
    expect(screen.queryByLabelText("Generate dashboard with AI")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New dashboard" }));

    const blank = await screen.findByText("Blank dashboard");
    expect(screen.getByText("Generate with AI")).toBeInTheDocument();

    fireEvent.click(blank);
    await waitFor(() =>
      expect(
        screen.getByText("Give your dashboard a name to get started."),
      ).toBeInTheDocument(),
    );
  });

  it("renders dashboard rows as child SidebarRows with the tint+bar when active", () => {
    mockUseParams.mockReturnValue({ dashboardId: "d1" });
    render(
      <TooltipProvider>
        <DashboardsNav
          dashboards={[
            { id: "d1", name: "Team" },
            { id: "d2", name: "Ops" },
          ]}
          activeWorkspaceId={activeWorkspaceId}
        />
      </TooltipProvider>,
    );
    const active = screen.getByRole("link", { name: "Team" })
      .parentElement as HTMLElement;
    expect(active.className).toContain("bg-state-selected");
    expect(active.className).toContain("before:bg-primary");
    expect(active.className).not.toContain("bg-primary/80");
    expect(screen.getByRole("link", { name: "Ops" }).className).toContain(
      "text-xs",
    );
    // 24px lead slot first, like every other row
    expect(active.firstElementChild?.className).toContain("size-6");
  });

  it("collapsed + coarse: shows the Dashboards header + name as visible captions (gotcha-47)", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(true);
    render(
      <TooltipProvider>
        <DashboardsNav
          collapsed
          dashboards={[{ id: "d1", name: "Revenue" }]}
          activeWorkspaceId={activeWorkspaceId}
        />
      </TooltipProvider>,
    );
    // Header link gains a visible caption (was tooltip-only).
    const header = screen.getByRole("link", { name: "Dashboards" });
    expect(header).toHaveTextContent("Dashboards");
    expect(header.className).toContain("pointer-coarse:min-h-11");
    // The dashboard tile keeps its initial AND shows the full name.
    const tile = screen.getByRole("link", { name: "Revenue" });
    expect(tile).toHaveTextContent("R");
    expect(tile).toHaveTextContent("Revenue");
  });

  it("collapsed + fine: stays icon/initial-only, no name caption", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(false);
    render(
      <TooltipProvider>
        <DashboardsNav
          collapsed
          dashboards={[{ id: "d1", name: "Revenue" }]}
          activeWorkspaceId={activeWorkspaceId}
        />
      </TooltipProvider>,
    );
    const tile = screen.getByRole("link", { name: "Revenue" });
    expect(tile).toHaveTextContent("R");
    expect(
      screen.queryByText("Revenue", { selector: "span" }),
    ).not.toBeInTheDocument();
  });

  it("opens from the store flag even when the sidebar is collapsed", async () => {
    render(
      <TooltipProvider>
        <DashboardsNav
          dashboards={[]}
          activeWorkspaceId={activeWorkspaceId}
          collapsed
        />
      </TooltipProvider>,
    );
    expect(
      screen.queryByText("Give your dashboard a name to get started."),
    ).toBeNull();
    useUIStore.setState({ newDashboardOpen: true });
    await waitFor(() =>
      expect(
        screen.getByText("Give your dashboard a name to get started."),
      ).toBeInTheDocument(),
    );
  });
});
