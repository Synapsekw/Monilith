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

  type Frame = {
    offset: number;
    transform: string;
    opacity: string;
    easing?: string;
  };
  const calls = () =>
    animate.mock.calls as unknown as [Frame[], KeyframeAnimationOptions][];
  /** The px arguments of every `translate(Xpx, Ypx)` in a transform list. */
  const translates = (transform: string) =>
    [...transform.matchAll(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/g)].map(
      // `+ 0` folds the "-0.0px" a zero throw to the left serialises to.
      (m) => [Number(m[1]) + 0, Number(m[2]) + 0] as const,
    );

  it("runs each square for 650–700ms, animating transform and opacity only", () => {
    fireDoneBurst(cell());
    for (const [keyframes, options] of calls()) {
      expect(options.duration).toBeGreaterThanOrEqual(650);
      expect(options.duration).toBeLessThanOrEqual(700);
      for (const frame of keyframes) {
        expect(
          Object.keys(frame)
            .filter((k) => k !== "offset" && k !== "easing")
            .sort(),
        ).toEqual(["opacity", "transform"]);
      }
    }
  });

  it("stays fully opaque while it travels and fades only over the last ~35%", () => {
    // The first version faded on the same ease-out as the movement: 0.51
    // opacity 50ms in and 0.06 at 200ms, so nothing was ever seen.
    fireDoneBurst(cell());
    for (const [keyframes, options] of calls()) {
      // Keyframe offsets are fractions of EASED progress. Only a linear
      // timing function makes "offset 0.65" mean "65% of the duration".
      expect(options.easing ?? "linear").toBe("linear");

      const offsets = keyframes.map((f) => f.offset);
      expect(offsets[0]).toBe(0);
      expect(offsets.at(-1)).toBe(1);
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);

      const fadeFrom = offsets.at(-2)!;
      expect(fadeFrom).toBeGreaterThanOrEqual(0.6);
      expect(fadeFrom).toBeLessThanOrEqual(0.7);
      for (const frame of keyframes.slice(0, -1)) {
        expect(frame.opacity, `offset ${frame.offset}`).toBe("1");
      }
      expect(keyframes.at(-1)!.opacity).toBe("0");
    }
  });

  it("has covered most of its travel by the time the fade starts", () => {
    fireDoneBurst(cell());
    for (const [keyframes] of calls()) {
      const radial = (f: Frame) => Math.hypot(...translates(f.transform)[1]);
      expect(radial(keyframes.at(-2)!)).toBeGreaterThanOrEqual(
        0.85 * radial(keyframes.at(-1)!),
      );
    }
  });

  it.each([
    ["shortest", 0],
    ["longest", 0.999999],
  ])(
    "flings 28–64px radially with a slight downward drift (%s throw)",
    (_name, random) => {
      vi.spyOn(Math, "random").mockReturnValue(random);
      fireDoneBurst(cell());
      for (const [keyframes] of calls()) {
        const first = keyframes[0].transform;
        const last = keyframes.at(-1)!.transform;
        // Anchored on the cell's centre, starting there.
        expect(first.startsWith("translate(-50%, -50%)")).toBe(true);
        expect(translates(first)).toEqual([
          [0, 0],
          [0, 0],
        ]);
        // translate #1 is the drift (straight down), #2 the radial throw.
        const [drift, radial] = translates(last);
        expect(drift[0]).toBe(0);
        expect(drift[1]).toBeGreaterThan(0);
        expect(drift[1]).toBeLessThanOrEqual(12);
        const reach = Math.hypot(...radial);
        expect(reach).toBeGreaterThanOrEqual(27.9);
        expect(reach).toBeLessThanOrEqual(64.1);
        // A little rotation — a tumble, not a spin.
        const turn = Math.abs(Number(last.match(/rotate\((-?[\d.]+)deg\)/)![1]));
        expect(turn).toBeGreaterThan(0);
        expect(turn).toBeLessThanOrEqual(90);
      }
      vi.restoreAllMocks();
    },
  );

  it("staggers the squares by a small random delay and holds the start pose through it", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    fireDoneBurst(cell());
    for (const [, options] of calls()) {
      expect(options.delay).toBeGreaterThan(0);
      expect(options.delay).toBeLessThanOrEqual(60);
      expect(options.fill).toBe("both");
    }
    random.mockReturnValue(0);
    animate.mockClear();
    fireDoneBurst(cell());
    for (const [, options] of calls()) expect(options.delay).toBe(0);
    vi.restoreAllMocks();
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
