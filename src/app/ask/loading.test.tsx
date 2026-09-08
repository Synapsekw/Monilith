import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AskLoading from "./loading";

describe("AskLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<AskLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors a column of messages above the composer bar", () => {
    render(<AskLoading />);
    expect(screen.getAllByTestId("ask-message-skeleton")).toHaveLength(3);
    expect(screen.getByTestId("ask-composer-skeleton")).toBeInTheDocument();
  });

  it("does not re-render the shell — the ask layout owns it", () => {
    render(<AskLoading />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
