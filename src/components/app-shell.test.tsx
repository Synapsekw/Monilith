import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./app-shell";
import { useUIStore } from "@/stores/ui";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({}),
}));

// The sidebar now imports the workspace client components, which import the
// "use server" actions module. Stub it so it doesn't evaluate in jsdom.
vi.mock("@/lib/workspaces/actions", () => ({
  createWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

// Radix's DropdownMenu relies on pointer-capture + scrollIntoView, which jsdom
// doesn't implement. Polyfill them so the menu can open in tests.
beforeEach(() => {
  useUIStore.setState({ sidebarCollapsed: false, hasHydrated: true });
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

describe("AppShell", () => {
  it("renders the MONOLITH brand and its children", () => {
    render(
      <AppShell>
        <div>Board content</div>
      </AppShell>,
    );

    expect(screen.getAllByText("MONOLITH").length).toBeGreaterThan(0);
    expect(screen.getByText("Board content")).toBeInTheDocument();
  });

  it("links the brand to the landing splash", () => {
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );

    const brandLinks = screen.getAllByRole("link", { name: /monolith/i });
    expect(brandLinks.length).toBeGreaterThan(0);
    expect(brandLinks[0]).toHaveAttribute("href", "/landing");
  });

  it("exposes the command palette trigger", () => {
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );

    expect(screen.getByText("Search…")).toBeInTheDocument();
  });

  it("shows the empty boards state when no boards are passed", () => {
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );

    expect(screen.getByText("No boards yet")).toBeInTheDocument();
  });

  it("renders a passed board name in the sidebar", () => {
    render(
      <AppShell
        boards={[
          {
            id: "b1",
            name: "Sprint backlog",
            workspace_id: "w1",
            position: 0,
            shared_out: false,
          },
        ]}
      >
        <div>content</div>
      </AppShell>,
    );

    expect(screen.getByText("Sprint backlog")).toBeInTheDocument();
  });

  it("renders live Dashboards, Portfolios and Goals links and a disabled Inbox stub", () => {
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );

    // Dashboards, Portfolios and Goals are wired sections (links), not disabled stubs.
    expect(screen.getByText("Dashboards").closest("a")).toHaveAttribute(
      "href",
      "/dashboards",
    );
    expect(screen.getByText("Portfolios").closest("a")).toHaveAttribute(
      "href",
      "/portfolios",
    );
    expect(screen.getByText("Goals").closest("a")).toHaveAttribute(
      "href",
      "/goals",
    );
    expect(screen.getByText("Inbox").closest("button")).toBeDisabled();
  });

  it("shows a Platform admin link in the user menu for platform admins", async () => {
    render(
      <AppShell user={{ email: "info@synapse-solutions.ai" }} isPlatformAdmin>
        <div>content</div>
      </AppShell>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /open user menu/i }),
    );

    // asChild merges the menuitem role onto the Link's <a>, so href is on it.
    const adminLink = await screen.findByRole("menuitem", {
      name: /platform admin/i,
    });
    expect(adminLink).toHaveAttribute("href", "/admin");
  });

  it("hides the Platform admin link for non-platform users", async () => {
    render(
      <AppShell user={{ email: "member@example.com" }}>
        <div>content</div>
      </AppShell>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /open user menu/i }),
    );

    // The menu opened (Settings is present) but no platform-admin entry.
    expect(
      await screen.findByRole("menuitem", { name: /settings/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /platform admin/i }),
    ).not.toBeInTheDocument();
  });
});
