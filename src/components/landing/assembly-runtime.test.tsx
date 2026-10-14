import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssemblyLanding } from "./assembly-landing";
import { mountAssembly } from "./assembly-runtime";

vi.mock("./assembly-effects", () => ({ AssemblyEffects: () => null }));

const observed = new Set<Element>();
class TestObserver {
  constructor(private callback?: () => void) {}
  observe(target: Element) {
    observed.add(target);
    if (target instanceof HTMLCanvasElement) this.callback?.();
  }
  unobserve(target: Element) {
    observed.delete(target);
  }
  disconnect() {
    observed.clear();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "IntersectionObserver",
    class extends TestObserver {
      constructor() {
        super();
      }
    },
  );
  vi.stubGlobal("ResizeObserver", TestObserver);
  // jsdom has no graphics contexts; the real fallback path still wires controls.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Assembly runtime lifecycle", () => {
  it("switches billing locally and stops handling events after disposal", () => {
    const { container } = render(<AssemblyLanding />);
    const root = container.firstElementChild as HTMLElement;
    const dispose = mountAssembly(root);
    fireEvent.click(screen.getByRole("button", { name: "Billed monthly" }));
    expect(root.querySelector('[data-price="core"]')).toHaveTextContent("12");
    expect(root.querySelector('[data-price="pulse"]')).toHaveTextContent("29");
    dispose();
    fireEvent.click(screen.getByRole("button", { name: "Billed yearly" }));
    expect(root.querySelector('[data-price="core"]')).toHaveTextContent("12");
    expect(observed.size).toBe(0);
    expect(root.querySelector(".joinery-render")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("opens the selected product screen and clears pending animation work", () => {
    const { container } = render(<AssemblyLanding />);
    const root = container.firstElementChild as HTMLElement;
    const dispose = mountAssembly(root);
    fireEvent.click(screen.getByRole("button", { name: /Bring your AI/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /explore the screen/i }),
    );
    expect(root.querySelector("dialog")).toHaveAttribute("open");
    expect(root.querySelector("[data-dialog-image]")).toHaveAttribute(
      "src",
      expect.stringContaining("/landing/assembly/agent-dock-blue.jpg"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Through your agent" }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => dispose());
    expect(vi.getTimerCount()).toBe(0);
    expect(document.documentElement).not.toHaveClass("js-motion");
  });
});

describe("mobile assembly scroll", () => {
  function mountMobile(reducedMotion = false) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches:
        query.includes("780px") ||
        (reducedMotion && query.includes("reduced-motion")),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const noop = () => {};
    const gradient = { addColorStop: noop };
    const context = new Proxy(
      {},
      {
        get: (_target, key) =>
          String(key).includes("Gradient") ? () => gradient : noop,
      },
    ) as CanvasRenderingContext2D;
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(((
      type: string,
    ) =>
      type === "2d"
        ? context
        : null) as typeof HTMLCanvasElement.prototype.getContext);
    const { container } = render(<AssemblyLanding />);
    const root = container.firstElementChild as HTMLElement;
    const intro = root.querySelector(".assembly-intro") as HTMLElement;
    const stage = root.querySelector(".assembly-art-stage") as HTMLElement;
    const art = root.querySelector(".hero-art") as HTMLElement;
    expect(stage).not.toBeNull();
    let top = 84;
    art.style.top = "84px";
    vi.spyOn(stage, "getBoundingClientRect").mockImplementation(
      () => ({ top }) as DOMRect,
    );
    Object.defineProperty(stage, "offsetHeight", { value: 1000 });
    Object.defineProperty(art, "offsetHeight", { value: 440 });
    vi.spyOn(
      root.querySelector("canvas")!,
      "getBoundingClientRect",
    ).mockReturnValue({ width: 390, height: 440 } as DOMRect);
    const dispose = mountAssembly(root);
    function progress(stageTop: number) {
      top = stageTop;
      fireEvent.scroll(window);
      act(() => vi.advanceTimersByTime(1500));
      return Number(intro.style.getPropertyValue("--assembly-progress"));
    }
    return { progress, dispose };
  }

  it("assembles through the sticky runway and reverses when scrolling back", () => {
    const { progress, dispose } = mountMobile();
    expect(progress(84)).toBe(0);
    expect(progress(84 - (560 * 0.85) / 2)).toBeCloseTo(0.42, 2);
    expect(progress(84 - 560 * 0.85)).toBeCloseTo(0.84, 2);
    expect(progress(84 - 560)).toBeCloseTo(0.84, 2);
    expect(progress(84)).toBeCloseTo(0, 2);
    dispose();
  });

  it("does not move the pieces when only the browser toolbar changes viewport height", () => {
    const { progress, dispose } = mountMobile();
    vi.stubGlobal("innerHeight", 664);
    const before = progress(-154);
    vi.stubGlobal("innerHeight", 740);
    fireEvent.resize(window);
    expect(progress(-154)).toBeCloseTo(before, 2);
    dispose();
  });

  it("shows the completed still assembly for reduced motion at every scroll position", () => {
    const { progress, dispose } = mountMobile(true);
    expect(progress(700)).toBe(0.84);
    expect(progress(-500)).toBe(0.84);
    dispose();
  });
});
