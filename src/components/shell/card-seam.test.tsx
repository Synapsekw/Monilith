import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardSeam, SEAM_CAP, seamHitClasses } from "./card-seam";
import { seamPath } from "@/lib/ui/seam-path";

const BOX = { width: 900, height: 600, radius: 19.6 };

/**
 * jsdom lays nothing out, so the seam's own measure reports 0×0 and it draws
 * nothing. Give the root a box and a radius, then run the observer the way a
 * real fold would.
 */
function measure(root: HTMLElement, box = BOX) {
  root.getBoundingClientRect = () =>
    ({ width: box.width, height: box.height }) as DOMRect;
  root.style.borderTopLeftRadius = `${box.radius}px`;
  const observer = (
    globalThis.ResizeObserver as unknown as {
      instances: { targets: Set<Element>; trigger: () => void }[];
    }
  ).instances.find((o) => o.targets.has(root));
  act(() => observer!.trigger());
}

function renderSeam(side: "left" | "right" = "left") {
  const view = render(
    <CardSeam side={side}>
      <button type="button" className={seamHitClasses(side)}>
        <span className={SEAM_CAP}>chevron</span>
      </button>
    </CardSeam>,
  );
  const root = view.container.querySelector(
    `[data-seam="${side}"]`,
  ) as HTMLElement;
  return { ...view, root };
}

describe("CardSeam", () => {
  it("draws nothing until it has a real box, but mounts its control immediately", () => {
    const { root } = renderSeam();
    // The control is in the prerendered shell and clickable on first paint; the
    // stroke waits for a measure rather than guessing a geometry.
    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(root.querySelector("svg")).toBeNull();
  });

  it("draws both halves of the edge once measured", () => {
    const { root } = renderSeam();
    measure(root);

    const paths = [...root.querySelectorAll("path.seam-line")];
    expect(paths).toHaveLength(2);

    const expected = seamPath({ ...BOX, side: "left" });
    expect(paths[0]!.getAttribute("d")).toBe(expected.up.d);
    expect(paths[1]!.getAttribute("d")).toBe(expected.down.d);
  });

  it("publishes each half's own length, and a gap at least as long", () => {
    // One dash per path, never two: the gap has to out-run the path or the
    // pattern repeats and the far corner lights before the near one.
    const { root } = renderSeam();
    measure(root);

    const expected = seamPath({ ...BOX, side: "left" });
    const path = root.querySelector("path.seam-line") as SVGPathElement;
    expect(path.style.getPropertyValue("--seam-rest")).toBe("15px");
    expect(path.style.getPropertyValue("--seam-len")).toBe(
      `${expected.up.length}px`,
    );
    expect(
      parseFloat(path.style.getPropertyValue("--seam-gap")),
    ).toBeGreaterThan(expected.up.length);
  });

  it("sizes its viewBox to the card, so a path unit is a CSS pixel", () => {
    const { root } = renderSeam();
    measure(root);
    const svg = root.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 900 600");
    expect(svg.getAttribute("width")).toBe("900");
  });

  it("redraws when the card's box changes", () => {
    // The fold animates the card's width for 200-360ms. A one-shot measure lit
    // only the top corner of a card that was 56px tall at first paint.
    const { root } = renderSeam();
    measure(root);
    const before = root.querySelector("path.seam-line")!.getAttribute("d");

    measure(root, { ...BOX, height: 320 });
    const after = root.querySelector("path.seam-line")!.getAttribute("d");

    expect(after).not.toBe(before);
    expect(after).toBe(seamPath({ ...BOX, height: 320, side: "left" }).up.d);
  });

  it("mirrors to the right edge", () => {
    const { root } = renderSeam("right");
    measure(root);
    expect(root.querySelector("path.seam-line")!.getAttribute("d")).toBe(
      seamPath({ ...BOX, side: "right" }).up.d,
    );
  });
});

describe("seamHitClasses", () => {
  it("runs the full edge for a mouse and shrinks to a 44px target for touch", () => {
    // Full height is right for a pointer — the whole edge is the control — but
    // on touch it would swallow the card's gutter from board scrolling.
    const left = seamHitClasses("left");
    expect(left).toContain("inset-y-0");
    expect(left).toContain("-left-1.5");
    expect(left).toContain("pointer-coarse:size-11");
    expect(left).toContain("pointer-coarse:inset-y-auto");
    expect(seamHitClasses("right")).toContain("-right-1.5");
  });
});
