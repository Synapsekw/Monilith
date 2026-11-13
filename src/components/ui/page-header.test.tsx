import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  PAGE_TITLE_CLASS,
  PAGE_TITLE_INPUT_CLASS,
  PageHeader,
} from "./page-header";
import { Input } from "./input";
import { cn } from "@/lib/utils";

/**
 * The rename inputs for the board and dashboard titles go through `<Input>`,
 * whose base is `text-base md:text-sm`. tailwind-merge only drops a class for
 * a later one in the SAME variant, so a bare `text-xl` leaves `md:text-sm`
 * standing and the input shrinks to 14px at >=768px. These render the real
 * `<Input>` with the real call-site class strings and read what survives.
 */
describe("PAGE_TITLE_INPUT_CLASS", () => {
  // BoardHeader and DashboardCanvas respectively.
  it.each(["h-7 w-56", "h-8 max-w-md"])(
    "keeps the 20px bold title scale at every width on an <Input> (%s)",
    (extra) => {
      render(
        <Input
          aria-label="Title"
          className={cn(PAGE_TITLE_INPUT_CLASS, extra)}
        />,
      );
      const classes = screen
        .getByRole("textbox", { name: "Title" })
        .className.split(/\s+/);
      expect(classes).toContain("text-xl");
      expect(classes).toContain("md:text-xl");
      expect(classes).toContain("font-bold");
      expect(classes).toContain("font-heading");
      // No size utility from the Input base survives, at any breakpoint.
      expect(
        classes.filter((c) => /^(?:md:)?text-(?:xs|sm|base|lg)$/.test(c)),
      ).toEqual([]);
    },
  );

  it("is the display title scale plus the desktop override, nothing else", () => {
    expect(PAGE_TITLE_INPUT_CLASS.split(/\s+/)).toEqual([
      ...PAGE_TITLE_CLASS.split(/\s+/),
      "md:text-xl",
    ]);
  });
});

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
