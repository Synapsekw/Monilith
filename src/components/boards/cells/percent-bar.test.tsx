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
  // Value-based red→green ramp so completion reads at a glance; the numeric
  // label carries the value too, so color is never the sole signal.
  it("colors the fill by value along the red→green ramp", () => {
    const { container: low } = render(<PercentBar percent={10} />);
    expect(fill(low).className).toContain("bg-[var(--progress-red)]");
    const { container: mid } = render(<PercentBar percent={60} />);
    expect(fill(mid).className).toContain("bg-[var(--progress-lime)]");
    const { container: full } = render(<PercentBar percent={100} />);
    expect(fill(full).className).toContain("bg-[var(--progress-complete)]");
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
