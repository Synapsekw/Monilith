import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PercentBar } from "./index";

function fill(container: HTMLElement): HTMLElement {
  const bar = container.querySelector('[role="progressbar"]');
  const el = bar?.firstElementChild as HTMLElement | null;
  if (!el) throw new Error("fill element not found");
  return el;
}

describe("PercentBar", () => {
  // Keystone: a single periwinkle accent fill (no red→green band); the numeric
  // label carries the value, so color is never the sole signal.
  it("fills with the periwinkle accent regardless of value", () => {
    const { container: low } = render(<PercentBar percent={10} />);
    expect(fill(low).className).toContain("bg-primary");
    const { container: full } = render(<PercentBar percent={100} />);
    expect(fill(full).className).toContain("bg-primary");
  });

  it("sets the fill width to the clamped percent", () => {
    const { container } = render(<PercentBar percent={73} />);
    expect(fill(container).style.width).toBe("73%");
  });

  it("clamps out-of-range values to the 0–100 fill width", () => {
    const { container: over } = render(<PercentBar percent={150} />);
    expect(fill(over).style.width).toBe("100%");
    const { container: under } = render(<PercentBar percent={-10} />);
    expect(fill(under).style.width).toBe("0%");
  });
});
