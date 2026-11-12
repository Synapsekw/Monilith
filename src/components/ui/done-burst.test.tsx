import { Suspense } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCelebrateDone,
  CELEBRATE_ATTR,
  CelebrateDoneSync,
  celebrateStatusEdit,
  fireDoneBurst,
  isCelebrationEnabled,
  PILL_POP_CLASS,
  popStatusPill,
} from "./done-burst";

type FakeAnimation = {
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
};

const root = document.documentElement;
const originalAnimate = Element.prototype.animate;
let animations: FakeAnimation[] = [];
let animate: ReturnType<typeof vi.fn>;

function setReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function particles(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-done-burst]")];
}

function cell(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = "<span data-status-pill>Done</span>";
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  animations = [];
  animate = vi.fn(() => {
    const animation: FakeAnimation = { onfinish: null, oncancel: null };
    animations.push(animation);
    return animation;
  });
  Element.prototype.animate = animate as unknown as Element["animate"];
  setReducedMotion(false);
  applyCelebrateDone(true);
});

afterEach(() => {
  Element.prototype.animate = originalAnimate;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  root.removeAttribute(CELEBRATE_ATTR);
  document.body.innerHTML = "";
});

describe("celebration preference on <html>", () => {
  it("is off until the account's value has been stamped", () => {
    root.removeAttribute(CELEBRATE_ATTR);
    expect(isCelebrationEnabled()).toBe(false);
  });

  it("follows applyCelebrateDone", () => {
    applyCelebrateDone(true);
    expect(root.getAttribute(CELEBRATE_ATTR)).toBe("on");
    expect(isCelebrationEnabled()).toBe(true);
    applyCelebrateDone(false);
    expect(root.getAttribute(CELEBRATE_ATTR)).toBe("off");
    expect(isCelebrationEnabled()).toBe(false);
  });

  it("CelebrateDoneSync stamps the streamed server value", async () => {
    root.removeAttribute(CELEBRATE_ATTR);
    const enabled = Promise.resolve(false);
    await act(async () => {
      render(
        <Suspense fallback={null}>
          <CelebrateDoneSync enabled={enabled} />
        </Suspense>,
      );
    });
    expect(root.getAttribute(CELEBRATE_ATTR)).toBe("off");
  });
});

describe("fireDoneBurst", () => {
  it("creates 12 small squares by default, out of the pointer's way", () => {
    fireDoneBurst(cell());

    const nodes = particles();
    expect(nodes).toHaveLength(12);
    expect(animate).toHaveBeenCalledTimes(12);
    for (const node of nodes) {
      expect(node.style.width).toBe("7px");
      expect(node.style.height).toBe("7px");
      expect(node.style.borderRadius).toBe("2px");
      expect(node.style.pointerEvents).toBe("none");
      expect(node.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("paints with the two accents and two status colours only", () => {
    fireDoneBurst(cell());
    expect(new Set(particles().map((n) => n.style.background))).toEqual(
      new Set([
        "var(--brand)",
        "var(--brand-2)",
        "var(--status-green)",
        "var(--status-yellow)",
      ]),
    );
  });

  it("never creates more than 12, whatever count is asked for", () => {
    fireDoneBurst(cell(), { count: 40 });
    expect(particles()).toHaveLength(12);
  });

  it("honours a smaller count", () => {
    fireDoneBurst(cell(), { count: 5 });
    expect(particles()).toHaveLength(5);
  });

  it("runs each square for 500ms, animating transform and opacity only", () => {
    fireDoneBurst(cell());
    const [keyframes, options] = animate.mock.calls[0] as [
      Record<string, string>[],
      KeyframeAnimationOptions,
    ];
    expect(options.duration).toBe(500);
    for (const frame of keyframes) {
      expect(Object.keys(frame).sort()).toEqual(["opacity", "transform"]);
    }
  });

  it("removes every square when its animation finishes", () => {
    fireDoneBurst(cell());
    expect(particles()).toHaveLength(12);
    for (const animation of animations) animation.onfinish?.();
    expect(particles()).toHaveLength(0);
  });

  it("removes a square whose animation is cancelled", () => {
    fireDoneBurst(cell(), { count: 1 });
    animations[0].oncancel?.();
    expect(particles()).toHaveLength(0);
  });

  it("creates nothing when the celebration is disabled", () => {
    applyCelebrateDone(false);
    fireDoneBurst(cell());
    expect(particles()).toHaveLength(0);
    expect(animate).not.toHaveBeenCalled();
  });

  it("creates nothing under prefers-reduced-motion", () => {
    setReducedMotion(true);
    fireDoneBurst(cell());
    expect(particles()).toHaveLength(0);
    expect(animate).not.toHaveBeenCalled();
  });

  it("creates nothing when the Web Animations API is unavailable", () => {
    const el = cell();
    Object.defineProperty(el, "animate", { value: undefined });
    fireDoneBurst(el);
    expect(particles()).toHaveLength(0);
  });
});

describe("popStatusPill", () => {
  it("adds the pop class to the pill and drops it when the run ends", () => {
    const el = cell();
    const pill = el.querySelector("[data-status-pill]")!;

    popStatusPill(el);
    expect(pill.classList.contains(PILL_POP_CLASS)).toBe(true);

    pill.dispatchEvent(new Event("animationend"));
    expect(pill.classList.contains(PILL_POP_CLASS)).toBe(false);
  });

  it("does nothing when disabled, under reduced motion, or with no pill", () => {
    const el = cell();
    const pill = el.querySelector("[data-status-pill]")!;

    applyCelebrateDone(false);
    popStatusPill(el);
    expect(pill.classList.contains(PILL_POP_CLASS)).toBe(false);

    applyCelebrateDone(true);
    setReducedMotion(true);
    popStatusPill(el);
    expect(pill.classList.contains(PILL_POP_CLASS)).toBe(false);

    setReducedMotion(false);
    expect(() => popStatusPill(document.createElement("div"))).not.toThrow();
  });
});

describe("celebrateStatusEdit", () => {
  function flushFrame() {
    vi.advanceTimersByTime(20);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
  });

  it("pops the pill after the frame, without a burst, for a plain change", () => {
    const el = cell();
    celebrateStatusEdit(() => el, false);
    expect(particles()).toHaveLength(0);

    flushFrame();
    expect(
      el.querySelector("[data-status-pill]")!.classList.contains(PILL_POP_CLASS),
    ).toBe(true);
    expect(particles()).toHaveLength(0);
  });

  it("adds the burst when the edit completed the item", () => {
    const el = cell();
    celebrateStatusEdit(() => el, true);
    flushFrame();
    expect(particles()).toHaveLength(12);
  });

  it("schedules nothing at all when the celebration is disabled", () => {
    applyCelebrateDone(false);
    const raf = vi.spyOn(window, "requestAnimationFrame");
    celebrateStatusEdit(() => cell(), true);
    expect(raf).not.toHaveBeenCalled();
  });

  it("survives the cell unmounting before the frame", () => {
    celebrateStatusEdit(() => null, true);
    expect(() => flushFrame()).not.toThrow();
    expect(particles()).toHaveLength(0);
  });
});
