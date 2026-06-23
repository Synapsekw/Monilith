import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./app-shell";
import { useUIStore } from "@/stores/ui";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({}),
}));

beforeEach(() => {
  useUIStore.setState({ sidebarCollapsed: false, hasHydrated: true });
});

function renderShell() {
  return render(
    <AppShell
      sidebarNav={<div>SIDEBAR_NAV_SLOT</div>}
      headerUser={<div>HEADER_USER_SLOT</div>}
      commandPalette={<div>COMMAND_PALETTE_SLOT</div>}
    >
      <div>Board content</div>
    </AppShell>,
  );
}

describe("AppShell frame", () => {
  it("renders children, the brand, the command trigger, and all three slots", () => {
    renderShell();
    expect(screen.getByText("Board content")).toBeInTheDocument();
    expect(screen.getAllByText("MONOLITH").length).toBeGreaterThan(0);
    expect(screen.getByText("Search…")).toBeInTheDocument();
    expect(screen.getByText("SIDEBAR_NAV_SLOT")).toBeInTheDocument();
    expect(screen.getByText("HEADER_USER_SLOT")).toBeInTheDocument();
    expect(screen.getByText("COMMAND_PALETTE_SLOT")).toBeInTheDocument();
  });

  it("links the brand to the landing splash", () => {
    renderShell();
    const brandLinks = screen.getAllByRole("link", { name: /monolith/i });
    expect(brandLinks.length).toBeGreaterThan(0);
    expect(brandLinks[0]).toHaveAttribute("href", "/landing");
  });
});
