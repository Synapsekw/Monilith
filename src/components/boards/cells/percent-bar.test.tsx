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
  it("colors a low value with the red band", () => {
    const { container } = render(<PercentBar percent={10} />);
    expect(fill(container).className).toContain("bg-[var(--progress-red)]");
  });

  it("colors a full value with the complete band", () => {
    const { container } = render(<PercentBar percent={100} />);
    expect(fill(container).className).toContain(
      "bg-[var(--progress-complete)]",
    );
  });

  it("sets the fill width to the clamped percent", () => {
    const { container } = render(<PercentBar percent={73} />);
    expect(fill(container).style.width).toBe("73%");
  });
});
