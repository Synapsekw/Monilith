import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import BoardLoading from "./loading";

describe("BoardLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<BoardLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the toolbar and eight dense table rows", () => {
    render(<BoardLoading />);
    expect(screen.getAllByTestId("board-row-skeleton")).toHaveLength(8);
    expect(screen.getByTestId("board-toolbar-skeleton")).toBeInTheDocument();
  });

  it("does not re-render the shell — the board layout owns it", () => {
    render(<BoardLoading />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
