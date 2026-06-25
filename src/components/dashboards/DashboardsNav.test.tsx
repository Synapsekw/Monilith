import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { DashboardsNav } from "./DashboardsNav";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUIStore } from "@/stores/ui";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/dashboards/actions", () => ({
  createDashboard: vi.fn(),
}));

beforeEach(() => {
  useUIStore.setState({ newDashboardOpen: false });
});

describe("DashboardsNav", () => {
  const workspaces = [{ id: "ws1", name: "WS" }];

  it("opens the create dialog when the newDashboardOpen store flag is set", async () => {
    render(<DashboardsNav dashboards={[]} workspaces={workspaces} />);
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
    render(<DashboardsNav dashboards={[]} workspaces={workspaces} />);

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

  it("opens from the store flag even when the sidebar is collapsed", async () => {
    render(
      <TooltipProvider>
        <DashboardsNav dashboards={[]} workspaces={workspaces} collapsed />
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
