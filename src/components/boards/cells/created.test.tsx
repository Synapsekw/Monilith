import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CreatedAtCell, CreatedByCell, formatDateTime } from "./created";

describe("formatDateTime", () => {
  it("returns '' for null or invalid input", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime("not-a-date")).toBe("");
  });
  it("formats a valid ISO string to a non-empty, year-bearing label", () => {
    const out = formatDateTime("2026-06-25T15:42:00Z");
    expect(out).not.toBe("");
    expect(out).toContain("2026");
  });
});

describe("CreatedByCell", () => {
  it("renders the creator name", () => {
    render(<CreatedByCell name="Danijel Jovanovic" />);
    expect(screen.getByText("Danijel Jovanovic")).toBeInTheDocument();
  });
  it("renders 'Unknown' when name is null", () => {
    render(<CreatedByCell name={null} />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
  it("renders the avatar image when avatarUrl is provided", () => {
    const { container } = render(
      <CreatedByCell name="Danijel Jovanovic" avatarUrl="https://x/y.png" />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://x/y.png",
    );
  });
});

describe("CreatedAtCell", () => {
  it("renders a formatted datetime for a valid ISO string", () => {
    render(<CreatedAtCell iso="2026-06-25T15:42:00Z" />);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });
  it("renders empty for null", () => {
    const { container } = render(<CreatedAtCell iso={null} />);
    expect(container.textContent).toBe("");
  });
});
