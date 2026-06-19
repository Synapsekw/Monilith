import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { LightRays } from "./light-rays";

// Drive reduced-motion per test via framer-motion's hook.
const reduced = { value: false };
vi.mock("framer-motion", () => ({
  useReducedMotion: () => reduced.value,
}));

describe("LightRays", () => {
  beforeEach(() => {
    reduced.value = false;
    vi.restoreAllMocks();
  });
  afterEach(() => {
    reduced.value = false;
  });

  it("renders an aria-hidden decorative container without throwing", () => {
    const { container } = render(<LightRays />);
    const el = container.querySelector("[aria-hidden]");
    expect(el).not.toBeNull();
  });

  it("applies a passed className to the container", () => {
    const { container } = render(<LightRays className="custom-rays" />);
    expect(container.querySelector(".custom-rays")).not.toBeNull();
  });

  it("under reduced motion it paints a single frame and starts no rAF loop", () => {
    reduced.value = true;
    const raf = vi.spyOn(window, "requestAnimationFrame");
    render(<LightRays />);
    expect(raf).not.toHaveBeenCalled();
  });

  it("with motion enabled it starts an animation loop", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    render(<LightRays />);
    expect(raf).toHaveBeenCalled();
  });

  it("unmounts cleanly without throwing", () => {
    const view = render(<LightRays />);
    expect(() => view.unmount()).not.toThrow();
  });
});
