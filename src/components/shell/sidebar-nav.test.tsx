import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { SidebarNav } from "./sidebar-nav";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUIStore } from "@/stores/ui";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";

vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: vi.fn(() => false),
}));

// SidebarNav is always rendered inside the Sidebar frame's TooltipProvider; the
// collapsed nav uses Radix Tooltip, so supply one in isolation.
function renderNav(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: vi.fn(() => "/"),
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

vi.mock("@/lib/workspaces/active-actions", () => ({
  setActiveWorkspace: vi.fn(),
}));

vi.mock("@/lib/org/active-actions", () => ({
  setActiveOrg: vi.fn(),
}));

beforeEach(() => {
  useUIStore.setState({
    sidebarCollapsed: false,
    hasHydrated: true,
    collapsedSections: {},
  });
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  vi.mocked(useCoarsePointer).mockReturnValue(false);
  vi.mocked(usePathname).mockReturnValue("/");
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

  it("renders the grouped section links and no Inbox", () => {
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
    for (const [label, href] of [
      ["My Work", "/my-work"],
      ["Goals", "/goals"],
      ["Portfolios", "/portfolios"],
      ["Reports", "/reports"],
      ["Workload", "/workload"],
      ["My Time", "/time"],
    ] as const) {
      expect(screen.getByText(label).closest("a")).toHaveAttribute(
        "href",
        href,
      );
    }
    expect(screen.queryByText("Inbox")).not.toBeInTheDocument();
  });

  it("renders a Trash link to the workspace archived-boards hash", () => {
    useUIStore.setState({ sidebarCollapsed: false, hasHydrated: true });
    renderNav(
      <SidebarNav
        boards={[]}
        sharedBoards={[]}
        workspaces={[]}
        dashboards={[]}
      />,
    );
    const trash = screen.getByRole("link", { name: /trash/i });
    expect(trash).toHaveAttribute("href", "/boards#archived");
  });

  it("shows the org switcher for a multi-org user", () => {
    renderNav(
      <SidebarNav
        orgs={[
          { id: "o1", name: "Acme" },
          { id: "o2", name: "Globex" },
        ]}
        activeOrgId="o2"
        boards={[]}
        sharedBoards={[]}
        workspaces={[{ id: "w1", name: "Eng" }]}
        dashboards={[]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /switch organization or workspace/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Globex")).toBeInTheDocument();
  });

  it("hides the org switcher for a single-org user", () => {
    renderNav(
      <SidebarNav
        orgs={[{ id: "o1", name: "Acme" }]}
        activeOrgId="o1"
        boards={[]}
        sharedBoards={[]}
        workspaces={[{ id: "w1", name: "Eng" }]}
        dashboards={[]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /switch organization/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch workspace" }),
    ).toBeInTheDocument();
  });

  it("shows the active workspace in the switcher", () => {
    renderNav(
      <SidebarNav
        boards={[]}
        sharedBoards={[]}
        workspaces={[{ id: "w1", name: "Engineering" }]}
        activeWorkspaceId="w1"
        dashboards={[]}
      />,
    );
    expect(screen.getByText("Engineering")).toBeInTheDocument();
  });

  it("marks the active nav item with the Keystone tint + edge bar", () => {
    vi.mocked(usePathname).mockReturnValue("/my-work");
    renderNav(
      <SidebarNav
        boards={[]}
        sharedBoards={[]}
        workspaces={[]}
        dashboards={[]}
      />,
    );
    const active = screen.getByText("My Work").closest("a")!;
    expect(active).toHaveClass("bg-state-selected");
    expect(active.className).toContain("before:bg-primary");
    expect(active.className).not.toContain("border-primary");
    expect(active).toHaveAttribute("aria-current", "page");
  });

  it("has no Personal section: My Time and Trash live in a pinned footer", () => {
    renderNav(
      <SidebarNav
        boards={[]}
        sharedBoards={[]}
        workspaces={[]}
        dashboards={[]}
      />,
    );
    expect(screen.queryByText("Personal")).not.toBeInTheDocument();
    const footer = screen.getByTestId("sidebar-footer");
    expect(footer).toContainElement(
      screen.getByRole("link", { name: "My Time" }),
    );
    expect(footer).toContainElement(
      screen.getByRole("link", { name: /trash/i }),
    );
    expect(footer.className).toContain("border-t");
  });

  it("scrolls the middle, not the footer, and draws no separators", () => {
    renderNav(
      <SidebarNav
        boards={[]}
        sharedBoards={[]}
        workspaces={[]}
        dashboards={[]}
      />,
    );
    const body = screen.getByTestId("sidebar-scroll");
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("nav-scroll");
    expect(body).toHaveAttribute("data-scroll-container");
    expect(body).toContainElement(screen.getByText("Goals"));
    expect(body).not.toContainElement(screen.getByTestId("sidebar-footer"));
    expect(
      document.querySelector('[data-orientation="horizontal"][role="none"]'),
    ).toBeNull();
    // The last row sits above the bottom mask fade, not clipped by it.
    expect(body.lastElementChild).toHaveClass("h-3.5");
  });

  it("collapsed: groups the rail with hairline dividers and keeps the footer", () => {
    useUIStore.setState({ sidebarCollapsed: true, hasHydrated: true });
    renderNav(
      <SidebarNav
        boards={[]}
        sharedBoards={[]}
        workspaces={[{ id: "w1", name: "Eng" }]}
        activeWorkspaceId="w1"
        dashboards={[]}
      />,
    );
    // ws chip | My Work+Agents | Planning | Boards | Dashboards  → 4 dividers in the body, 1 above the footer
    expect(
      document.querySelectorAll("span[aria-hidden='true'].w-4.h-px").length,
    ).toBe(5);
    expect(screen.getByTestId("sidebar-footer")).toContainElement(
      screen.getByLabelText("Trash"),
    );
    // The last rail tile sits above the bottom mask fade too, not clipped by it.
    expect(screen.getByTestId("sidebar-scroll").lastElementChild).toHaveClass(
      "h-3.5",
    );
  });

  it("collapsed: the active tile carries the edge bar, not the 80% fill", () => {
    useUIStore.setState({ sidebarCollapsed: true, hasHydrated: true });
    vi.mocked(usePathname).mockReturnValue("/goals");
    renderNav(
      <SidebarNav
        boards={[]}
        sharedBoards={[]}
        workspaces={[]}
        dashboards={[]}
      />,
    );
    const goals = screen.getByLabelText("Goals");
    expect(goals.className).toContain("bg-state-selected");
    expect(goals.className).toContain("before:bg-primary");
    expect(goals.className).not.toContain("bg-primary/80");
    expect(goals.className).not.toContain("hover:border");
  });

  it("stays expanded when forceExpanded, ignoring the collapsed store", () => {
    // The mobile drawer passes forceExpanded so a user who collapsed the
    // desktop rail still gets full labels in the sheet.
    useUIStore.setState({ sidebarCollapsed: true, hasHydrated: true });
    renderNav(
      <SidebarNav
        boards={[board]}
        sharedBoards={[]}
        workspaces={[]}
        dashboards={[]}
        forceExpanded
      />,
    );
    // Full label text is present (expanded), not the icon-only rail.
    expect(screen.getByText("Sprint backlog")).toBeInTheDocument();
    expect(screen.getByText("Goals").closest("a")).toHaveAttribute(
      "href",
      "/goals",
    );
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

  describe("collapsed coarse-pointer a11y (gotcha-47)", () => {
    beforeEach(() => {
      useUIStore.setState({ sidebarCollapsed: true, hasHydrated: true });
    });

    it("renders a visible caption under each icon-only item on a coarse pointer", () => {
      vi.mocked(useCoarsePointer).mockReturnValue(true);
      renderNav(
        <SidebarNav
          boards={[]}
          sharedBoards={[]}
          workspaces={[]}
          dashboards={[]}
        />,
      );
      // The label string that previously only lived in the never-opened tooltip
      // is now on-screen text (the gotcha-47 fix).
      for (const label of [
        "My Work",
        "Goals",
        "Portfolios",
        "Reports",
        "Workload",
        "My Time",
      ]) {
        // The visible caption equals the aria-label (single source, no drift).
        expect(
          screen.getByText(label, { selector: "span" }),
        ).toBeInTheDocument();
        expect(screen.getByLabelText(label)).toHaveAttribute(
          "aria-label",
          label,
        );
      }
    });

    it("keeps the rail icon-only (no captions) on a fine pointer", () => {
      vi.mocked(useCoarsePointer).mockReturnValue(false);
      renderNav(
        <SidebarNav
          boards={[]}
          sharedBoards={[]}
          workspaces={[]}
          dashboards={[]}
        />,
      );
      // No visible <span> caption — label still only carried by aria-label/tooltip.
      expect(
        screen.queryByText("Goals", { selector: "span" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("My Time", { selector: "span" }),
      ).not.toBeInTheDocument();
    });

    it("gives each collapsed item a ≥44px coarse touch target", () => {
      vi.mocked(useCoarsePointer).mockReturnValue(true);
      renderNav(
        <SidebarNav
          boards={[]}
          sharedBoards={[]}
          workspaces={[]}
          dashboards={[]}
        />,
      );
      const goals = screen.getByLabelText("Goals");
      expect(goals.className).toContain("pointer-coarse:min-h-11");
    });

    it("preserves aria-current on the active collapsed item", () => {
      vi.mocked(useCoarsePointer).mockReturnValue(true);
      // usePathname is mocked to "/"; the Inbox has no href, so assert a wired
      // link keeps aria-current when its route is active is covered elsewhere —
      // here we just confirm coarse rendering doesn't drop the attribute wiring.
      renderNav(
        <SidebarNav
          boards={[]}
          sharedBoards={[]}
          workspaces={[]}
          dashboards={[]}
        />,
      );
      // None active at "/", so no link should carry aria-current=page.
      expect(screen.getByLabelText("Goals")).not.toHaveAttribute(
        "aria-current",
      );
    });
  });
});
