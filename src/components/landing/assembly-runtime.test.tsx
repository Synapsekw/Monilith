import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssemblyLanding } from "./assembly-landing";
import { mountAssembly } from "./assembly-runtime";

vi.mock("./assembly-effects", () => ({ AssemblyEffects: () => null }));

const observed = new Set<Element>();
class TestObserver {
  observe(target: Element) {
    observed.add(target);
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
  vi.stubGlobal("IntersectionObserver", TestObserver);
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
