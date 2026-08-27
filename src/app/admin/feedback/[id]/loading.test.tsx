import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminFeedbackDetailLoading from "./loading";

describe("AdminFeedbackDetailLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<AdminFeedbackDetailLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAttribute("aria-label", "Loading feedback detail");
  });

  it("mirrors the page's centered column and both detail cards", () => {
    render(<AdminFeedbackDetailLoading />);
    const status = screen.getByRole("status");
    // The real page is `mx-auto max-w-2xl` — a full-width fallback would snap
    // the content inward when it commits.
    expect(status.className).toContain("mx-auto");
    expect(status.className).toContain("max-w-2xl");
    expect(screen.getByTestId("report-card-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("triage-card-skeleton")).toBeInTheDocument();
  });
});
