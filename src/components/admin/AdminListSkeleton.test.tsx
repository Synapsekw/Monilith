import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminListSkeleton } from "./AdminListSkeleton";

const GRID = "grid grid-cols-[2fr_1.4fr_1fr_0.8fr_90px] gap-3";

describe("AdminListSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(
      <AdminListSkeleton
        label="organizations"
        gridClass={GRID}
        cellWidths={["w-48", null]}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAttribute("aria-label", "Loading organizations");
  });

  it("applies the caller's column template to the head and every row", () => {
    // The template has to reach both, or the header cells sit over the wrong
    // columns and the real table snaps sideways when it commits.
    render(
      <AdminListSkeleton
        label="organizations"
        gridClass={GRID}
        cellWidths={["w-48", "w-32", null]}
        rows={3}
      />,
    );
    expect(screen.getByTestId("skeleton-table-header").className).toContain(
      "grid-cols-[2fr_1.4fr_1fr_0.8fr_90px]",
    );
    const rows = screen.getAllByTestId("admin-row-skeleton");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.className).toContain("grid-cols-[2fr_1.4fr_1fr_0.8fr_90px]");
    }
  });

  it("renders one cell per column, with nulls left empty", () => {
    render(
      <AdminListSkeleton
        label="users"
        gridClass={GRID}
        cellWidths={["w-44", "w-40", "w-16", null]}
        rows={1}
      />,
    );
    const row = screen.getAllByTestId("admin-row-skeleton")[0];
    expect(row.children).toHaveLength(4);
    // The trailing action column is a spacer, not a shimmer — a skeleton block
    // there reads as a value that never arrives.
    expect(row.children[3].className).toBe("");
  });

  it("omits the toolbar by default and renders the requested variant", () => {
    const { rerender } = render(
      <AdminListSkeleton
        label="audit"
        gridClass={GRID}
        cellWidths={["w-20"]}
      />,
    );
    expect(screen.queryByTestId("skeleton-toolbar")).toBeNull();

    rerender(
      <AdminListSkeleton
        label="users"
        gridClass={GRID}
        cellWidths={["w-20"]}
        toolbar="search"
      />,
    );
    expect(screen.getByTestId("skeleton-toolbar").className).not.toContain(
      "flex-wrap",
    );

    rerender(
      <AdminListSkeleton
        label="feedback"
        gridClass={GRID}
        cellWidths={["w-20"]}
        toolbar="filters"
      />,
    );
    // The filter strip wraps; the search strip is a single row.
    expect(screen.getByTestId("skeleton-toolbar").className).toContain(
      "flex-wrap",
    );
  });

  it("renders the header and pager scaffolding", () => {
    render(
      <AdminListSkeleton
        label="users"
        gridClass={GRID}
        cellWidths={["w-20"]}
      />,
    );
    expect(screen.getByTestId("skeleton-header")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton-pager")).toBeInTheDocument();
  });
});
