import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarNav } from "./sidebar-nav";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUIStore } from "@/stores/ui";

// SidebarNav is always rendered inside the Sidebar frame's TooltipProvider; the
// collapsed nav uses Radix Tooltip, so supply one in isolation.
function renderNav(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

// The workspace client components import the "use server" actions module; stub
// it so it doesn't evaluate in jsdom (mirrors app-shell.test.tsx).
vi.mock("@/lib/workspaces/actions", () => ({
  createWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

beforeEach(() => {
  useUIStore.setState({ sidebarCollapsed: false, hasHydrated: true });
  Element.prototype.scrollIntoView ??= () => {};
});

const board = {
  id: "b1",
  name: "Sprint backlog",
  workspace_id: "w1",
  position: 0,
  shared_out: false,
};

describe("SidebarNav", () => {
  it("renders the empty boards state when none are passed", () => {
    renderNav(
      <SidebarNav
        boards={[]}
        sharedBoards={[]}
        workspaces={[]}
        dashboards={[]}
      />,
    );
    expect(screen.getByText("No boards yet")).toBeInTheDocument();
    expect(screen.getByText("No dashboards yet")).toBeInTheDocument();
  });

  it("renders a passed board name", () => {
    renderNav(
      <SidebarNav
        boards={[board]}
        sharedBoards={[]}
        workspaces={[]}
        dashboards={[]}
      />,
    );
    expect(screen.getByText("Sprint backlog")).toBeInTheDocument();
  });

  it("renders the wired section links and a disabled Inbox stub", () => {
    renderNav(
      <SidebarNav
        boards={[]}
        sharedBoards={[]}
        workspaces={[]}
        dashboards={[]}
      />,
    );
    expect(screen.getByText("Dashboards").closest("a")).toHaveAttribute(
      "href",
      "/dashboards",
    );
    expect(screen.getByText("Goals").closest("a")).toHaveAttribute(
      "href",
      "/goals",
    );
    expect(screen.getByText("Portfolios").closest("a")).toHaveAttribute(
      "href",
      "/portfolios",
    );
    expect(screen.getByText("Workload").closest("a")).toHaveAttribute(
      "href",
      "/workload",
    );
    expect(screen.getByText("Inbox").closest("button")).toBeDisabled();
  });

  it("renders the Workspaces block when workspaces exist", () => {
    renderNav(
      <SidebarNav
        boards={[]}
        sharedBoards={[]}
        workspaces={[{ id: "w1", name: "Engineering" }]}
        dashboards={[]}
      />,
    );
    expect(screen.getByText("Engineering")).toBeInTheDocument();
  });

  it("hides text labels when collapsed", () => {
    useUIStore.setState({ sidebarCollapsed: true, hasHydrated: true });
    renderNav(
      <SidebarNav
        boards={[]}
        sharedBoards={[]}
        workspaces={[]}
        dashboards={[]}
      />,
    );
    // Collapsed Dashboards renders an icon-only link, not a text label.
    expect(screen.queryByText("No boards yet")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Dashboards" }),
    ).toBeInTheDocument();
  });
});
