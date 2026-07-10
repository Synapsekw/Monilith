// src/components/portfolios/PriorityPill.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PriorityPill } from "./PriorityPill";

describe("PriorityPill", () => {
  it("renders a soft StatusPill at the Keystone chip geometry for a priority", () => {
    render(<PriorityPill priority="critical" />);
    const pill = screen.getByText("Critical");
    // The old implementation was a bare `<span className="text-xs font-medium">`
    // with no chip geometry — `rounded-sm` only appears once StatusPill is used.
    expect(pill).toHaveClass("rounded-sm");
    expect(pill).toHaveClass("text-xs");
  });

  it("uses the red soft tone for critical priority", () => {
    render(<PriorityPill priority="critical" />);
    const pill = screen.getByText("Critical");
    expect(pill.className).toMatch(/bg-status-red\/15/);
  });

  it("renders an em dash for a null priority", () => {
    render(<PriorityPill priority={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
