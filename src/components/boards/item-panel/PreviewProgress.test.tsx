import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreviewProgress } from "./PreviewProgress";

describe("PreviewProgress", () => {
  it("renders a determinate bar with the percentage filled", () => {
    render(<PreviewProgress label="Downloading…" value={0.42} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByTestId("preview-progress-fill")).toHaveStyle({
      width: "42%",
    });
  });

  it("reports no value when progress is unknown", () => {
    // ARIA: an indeterminate bar omits aria-valuenow entirely. Reporting 0
    // would tell a screen-reader user "0% complete", which is a different and
    // wrong claim.
    render(<PreviewProgress label="Rendering…" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(
      screen.getByTestId("preview-progress-indeterminate"),
    ).toBeInTheDocument();
  });

  it("clamps out-of-range values instead of overflowing the track", () => {
    const { rerender } = render(<PreviewProgress label="x" value={1.8} />);
    expect(screen.getByTestId("preview-progress-fill")).toHaveStyle({
      width: "100%",
    });
    rerender(<PreviewProgress label="x" value={-3} />);
    expect(screen.getByTestId("preview-progress-fill")).toHaveStyle({
      width: "0%",
    });
  });

  it("shows the label and names the bar with it", () => {
    render(<PreviewProgress label="Downloading 2.4 MB of 8.1 MB" />);
    expect(
      screen.getByText("Downloading 2.4 MB of 8.1 MB"),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-label",
      "Downloading 2.4 MB of 8.1 MB",
    );
  });
});
