import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette } from "./command-palette";
import { useUIStore } from "@/stores/ui";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: vi.fn() }),
}));

const boards = [
  { id: "b1", name: "Sprint backlog", workspace_id: "ws1", position: 0 },
  { id: "b2", name: "Roadmap", workspace_id: "ws1", position: 1 },
];
const dashboards = [{ id: "d1", name: "Team overview" }];
const workspaces = [{ id: "ws1", name: "WS" }];

function renderOpen() {
  useUIStore.setState({
    commandOpen: true,
    newBoardOpen: false,
    newDashboardOpen: false,
  });
  return render(
    <CommandPalette
      boards={boards}
      dashboards={dashboards}
      workspaces={workspaces}
    />,
  );
}

beforeEach(() => {
  push.mockReset();
  useUIStore.setState({ commandOpen: false });
});

describe("CommandPalette", () => {
  it("renders a navigation item per board and per dashboard", () => {
    renderOpen();
    expect(screen.getByText("Sprint backlog")).toBeInTheDocument();
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(screen.getByText("Team overview")).toBeInTheDocument();
  });

  it("navigates to a board on select and closes", () => {
    renderOpen();
    fireEvent.click(screen.getByText("Sprint backlog"));
    expect(push).toHaveBeenCalledWith("/boards/b1");
    expect(useUIStore.getState().commandOpen).toBe(false);
  });

  it("New board sets the newBoardOpen flag and closes", () => {
    renderOpen();
    fireEvent.click(screen.getByText("New board"));
    expect(useUIStore.getState().newBoardOpen).toBe(true);
    expect(useUIStore.getState().commandOpen).toBe(false);
  });

  it("New dashboard sets the newDashboardOpen flag", () => {
    renderOpen();
    fireEvent.click(screen.getByText("New dashboard"));
    expect(useUIStore.getState().newDashboardOpen).toBe(true);
  });
});
