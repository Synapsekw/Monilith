import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import UpdatesLoading from "./loading";

describe("UpdatesLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<UpdatesLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the timeline's four entries", () => {
    render(<UpdatesLoading />);
    expect(screen.getAllByTestId("update-entry-skeleton")).toHaveLength(4);
  });

  it("does not re-render a heading or nav", () => {
    render(<UpdatesLoading />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
