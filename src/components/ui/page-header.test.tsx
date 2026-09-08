import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders an h1 with the shared type ramp", () => {
    render(<PageHeader title="Boards" />);
    const h = screen.getByRole("heading", { level: 1, name: "Boards" });
    expect(h.className).toMatch(/font-heading/);
    expect(h.className).toMatch(/text-lg/);
    expect(h.className).toMatch(/font-semibold/);
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
