import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({}),
}));

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

  it("links the brand back to the home route", () => {
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );

    const brandLinks = screen.getAllByRole("link", { name: /monolith/i });
    expect(brandLinks.length).toBeGreaterThan(0);
    expect(brandLinks[0]).toHaveAttribute("href", "/");
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
          { id: "b1", name: "Sprint backlog", workspace_id: "w1", position: 0 },
        ]}
      >
        <div>content</div>
      </AppShell>,
    );

    expect(screen.getByText("Sprint backlog")).toBeInTheDocument();
  });

  it("renders disabled nav stubs for Dashboards, Goals, Portfolios, Inbox", () => {
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );

    const dashboards = screen.getByText("Dashboards");
    expect(dashboards.closest("button")).toBeDisabled();
    expect(screen.getByText("Goals").closest("button")).toBeDisabled();
    expect(screen.getByText("Portfolios").closest("button")).toBeDisabled();
    expect(screen.getByText("Inbox").closest("button")).toBeDisabled();
  });
});
