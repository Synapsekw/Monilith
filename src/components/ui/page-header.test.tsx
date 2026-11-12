import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders an h1 with the shared type ramp", () => {
    render(<PageHeader title="Boards" />);
    const h = screen.getByRole("heading", { level: 1, name: "Boards" });
    expect(h.className).toMatch(/font-heading/);
  });
  it("sets the page title at the 20px bold anchor scale", () => {
    render(<PageHeader title="Boards" />);
    const h = screen.getByRole("heading", { level: 1, name: "Boards" });
    expect(h).toHaveClass("text-xl", "font-bold", "tracking-[-0.02em]");
    expect(h).not.toHaveClass("text-lg");
    expect(h).not.toHaveClass("font-semibold");
    expect(h).not.toHaveClass("tracking-tight");
  });
  it("keeps nested h2 section headings one step below the page title", () => {
    render(<PageHeader as="h2" title="Profile" />);
    const h = screen.getByRole("heading", { level: 2, name: "Profile" });
    expect(h).toHaveClass("text-lg", "font-semibold");
    expect(h).not.toHaveClass("text-xl");
  });
  it("renders kicker, description and actions when given", () => {
    render(
      <PageHeader
        kicker="Planning"
        index="01"
        title="Goals"
        description="Quarter view"
        actions={<button>New</button>}
      />,
    );
    expect(screen.getByText("Planning")).toHaveClass("text-kicker");
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("Quarter view")).toHaveClass(
      "text-muted-foreground",
    );
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });
  it("can render as h2 for nested sections", () => {
    render(<PageHeader as="h2" title="Profile" />);
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });
});
