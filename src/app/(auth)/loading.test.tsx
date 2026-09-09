import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AuthLoading from "./loading";

describe("AuthLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<AuthLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("renders one centered card skeleton", () => {
    render(<AuthLoading />);
    expect(screen.getByTestId("auth-card-skeleton")).toBeInTheDocument();
  });

  it("does not re-render a heading or nav — AuthLayout owns the brand mark", () => {
    render(<AuthLoading />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
