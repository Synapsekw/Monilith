import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DashboardsNav } from "./DashboardsNav";
import { useUIStore } from "@/stores/ui";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({}),
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
});
