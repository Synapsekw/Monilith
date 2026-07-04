import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileNav } from "./mobile-nav";
import { useUIStore } from "@/stores/ui";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";

vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: vi.fn(() => false),
}));

// Mutable pathname so we can drive the close-on-navigation effect.
let mockPathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => mockPathname,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/workspaces/actions", () => ({
  createWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

const navProps = {
  boards: [
    {
      id: "b1",
      name: "Sprint backlog",
      workspace_id: "w1",
      position: 0,
      shared_out: false,
    },
  ],
  sharedBoards: [],
  workspaces: [],
  dashboards: [],
};

beforeEach(() => {
  mockPathname = "/";
  useUIStore.setState({ sidebarCollapsed: true, hasHydrated: true });
  Element.prototype.scrollIntoView ??= () => {};
  vi.mocked(useCoarsePointer).mockReturnValue(false);
});

describe("MobileNav", () => {
  it("renders a labelled hamburger trigger, drawer closed by default", () => {
    render(<MobileNav {...navProps} />);
    expect(
      screen.getByRole("button", { name: /open navigation menu/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Sprint backlog")).not.toBeInTheDocument();
  });

  it("opens the drawer with the shared nav content, expanded despite a collapsed rail", async () => {
    render(<MobileNav {...navProps} />);
    await userEvent.click(
      screen.getByRole("button", { name: /open navigation menu/i }),
    );
    // Even though the desktop rail is collapsed, the drawer forces the
    // expanded nav — full board labels are visible.
    expect(await screen.findByText("Sprint backlog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes the drawer when the route changes", async () => {
    const { rerender } = render(<MobileNav {...navProps} />);
    await userEvent.click(
      screen.getByRole("button", { name: /open navigation menu/i }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // Simulate a navigation: the pathname changes, the effect closes the sheet.
    mockPathname = "/goals";
    rerender(<MobileNav {...navProps} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
