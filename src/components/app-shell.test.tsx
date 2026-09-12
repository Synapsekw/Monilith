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
      mobileNav={<div>MOBILE_NAV_SLOT</div>}
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
    expect(screen.getByText("MOBILE_NAV_SLOT")).toBeInTheDocument();
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

describe("surface model", () => {
  it("paints the wash on the shell root, not on body", () => {
    const { container } = renderShell();
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("app-wash");
    expect(root).toHaveClass("h-svh");
  });

  it("renders main as the one inset opaque card", () => {
    renderShell();
    const main = screen.getByRole("main");
    expect(main).toHaveClass("bg-content-surface");
    expect(main).toHaveClass("rounded-xl");
    expect(main).toHaveClass("border-content-edge");
    expect(main).toHaveClass("shadow-content-lift");
  });

  it("leaves the header transparent — separation is the gutter, not a line", () => {
    renderShell();
    const header = screen.getByRole("banner");
    expect(header.className).not.toMatch(/\bborder-b\b/);
    expect(header.className).not.toMatch(/\bbg-/);
  });
});

describe("dock slot", () => {
  it("renders an empty, static #app-dock-slot right after the header+main column", () => {
    const { container } = renderShell();
    const slot = container.querySelector(
      "#app-dock-slot",
    ) as HTMLElement | null;
    expect(slot).not.toBeNull();
    expect(slot).toBeEmptyDOMElement();
    expect(slot).toHaveClass("flex");
    expect(slot).toHaveClass("shrink-0");
    // The column that holds the header and the card frame is the slot's previous
    // sibling, so the portalled dock lands beside the card — rail | card | dock.
    const frame = screen.getByRole("main").parentElement as HTMLElement;
    expect(frame).toHaveAttribute("id", "app-card-frame");
    expect(slot!.previousElementSibling).toBe(frame.parentElement);
  });

  it("collapses the card's right gutter to mr-1 only while the slot is filled, in pure CSS", () => {
    const { container } = renderShell();
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass(
      "[&:has(#app-dock-slot:not(:empty))_#app-card-frame]:mr-1",
    );
    // The gutter lives on the FRAME now, not on <main> — the frame is what the
    // seam overlays, so both have to be the same box.
    const frame = container.querySelector("#app-card-frame") as HTMLElement;
    expect(frame).toHaveClass("mr-2");
    expect(frame).toHaveClass("relative");
    expect(screen.getByRole("main")).toHaveClass("absolute");
    expect(screen.getByRole("main")).toHaveClass("inset-0");
  });

  it("renders an empty, static #card-seam-slot inside the frame for the dock's seam", () => {
    const { container } = renderShell();
    const slot = container.querySelector("#card-seam-slot");
    expect(slot).not.toBeNull();
    expect(slot).toBeEmptyDOMElement();
    expect(slot!.parentElement).toHaveAttribute("id", "app-card-frame");
  });

  it("mounts the sidebar's lit seam on the card's left edge", () => {
    const { container } = renderShell();
    const seam = container.querySelector('[data-seam="left"]');
    expect(seam).not.toBeNull();
    expect(seam!.parentElement).toHaveAttribute("id", "app-card-frame");
    expect(
      screen.getByRole("button", { name: /collapse sidebar/i }),
    ).toBeInTheDocument();
  });
});
