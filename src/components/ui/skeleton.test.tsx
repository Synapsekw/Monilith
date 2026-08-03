import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("renders an animated muted block and merges className", () => {
    const { container } = render(<Skeleton className="h-8 w-48" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass("animate-pulse");
    expect(el).toHaveClass("h-8");
    expect(el).toHaveClass("w-48");
  });

  it("forwards arbitrary props like aria-hidden", () => {
    const { container } = render(<Skeleton aria-hidden="true" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  // REGRESSION LOCK. `Skeleton` is a shared primitive: 12 modules import it and
  // 67 call sites render it, almost all inside the opaque content card where
  // `bg-muted` is still exactly right. The chrome fix MUST be opt-in, so this
  // case exists to make "just change the default" fail loudly.
  it("defaults to the opaque content fill", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass("bg-muted");
    expect(el.className).not.toMatch(/\bbg-chrome-fill\b/);
  });

  it("paints alpha-on-parent in the chrome variant", () => {
    const { container } = render(<Skeleton variant="chrome" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass("bg-chrome-fill");
    expect(el.className).not.toMatch(/\bbg-muted\b/);
  });
});
