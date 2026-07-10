// src/components/ui/color-chip.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ColorChip } from "./color-chip";

describe("ColorChip", () => {
  it("renders children at the sanctioned chip geometry", () => {
    render(<ColorChip color="#8ea2eb">Sprint 24</ColorChip>);
    const chip = screen.getByText("Sprint 24");
    expect(chip).toHaveClass("rounded-sm", "text-xs");
  });

  it("carries per-theme AA-derived text colors as CSS custom properties", () => {
    render(<ColorChip color="#8ea2eb">Label</ColorChip>);
    const chip = screen.getByText("Label");
    // both --pill-fg-light and --pill-fg-dark are set from softPillText()
    expect(chip.style.getPropertyValue("--pill-fg-light")).toMatch(/^#/);
    expect(chip.style.getPropertyValue("--pill-fg-dark")).toMatch(/^#/);
    expect(chip.style.getPropertyValue("--pill")).toBe("#8ea2eb");
  });

  it("merges a passed className (so callers can opt into hover motion)", () => {
    render(
      <ColorChip color="#8ea2eb" className="hover:-translate-y-px">
        L
      </ColorChip>,
    );
    expect(screen.getByText("L")).toHaveClass("hover:-translate-y-px");
  });
});
