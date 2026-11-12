import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Mono } from "./mono";

describe("Mono", () => {
  it("renders a decorative svg at the default size", () => {
    const { container } = render(<Mono />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "48");
    expect(svg).toHaveAttribute("height", "48");
    expect(svg).toHaveAttribute("data-mood", "idle");
  });

  it("passes size and className through", () => {
    const { container } = render(<Mono size={72} className="shrink-0" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("width", "72");
    expect(svg).toHaveAttribute("height", "72");
    expect(svg).toHaveClass("shrink-0");
  });

  it("centres the body in its viewBox, on both axes", () => {
    // The shell is not symmetric about the origin (it bulges right and down),
    // so a viewBox centred on 0,0-ish left Mono 1.6px right of centre at 96px.
    const { container } = render(<Mono />);
    const svg = container.querySelector("svg")!;
    const [minX, minY, width, height] = svg
      .getAttribute("viewBox")!
      .split(/\s+/)
      .map(Number);
    expect(width).toBe(height);

    // Bounds of the body outline: `M x y` then cubic segments `C … x y`.
    const n = container
      .querySelector("svg > path")!
      .getAttribute("d")!
      .match(/-?\d+(\.\d+)?/g)!
      .map(Number);
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i + 7 < n.length; i += 6) {
      const [ax, ay, bx, by, cx, cy, dx, dy] = n.slice(i, i + 8);
      for (let s = 0; s <= 400; s++) {
        const t = s / 400;
        const u = 1 - t;
        const at = (a: number, b: number, c: number, d: number) =>
          u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
        const [x, y] = [at(ax, bx, cx, dx), at(ay, by, cy, dy)];
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    // Sanity: the outline really is the widest thing drawn.
    expect(x1 - x0).toBeGreaterThan(200);

    // Within a quarter of a unit — 0.1px at the 96px empty-state size.
    expect(Math.abs((x0 + x1) / 2 - (minX + width / 2))).toBeLessThan(0.25);
    expect(Math.abs((y0 + y1) / 2 - (minY + height / 2))).toBeLessThan(0.25);
  });

  it("idle has two round eyes and a smile", () => {
    const { container } = render(<Mono mood="idle" />);
    expect(container.querySelectorAll('[data-eye="round"]').length).toBe(2);
    expect(container.querySelectorAll('[data-eye="arc"]').length).toBe(0);
    expect(container.querySelectorAll("[data-smile]").length).toBe(1);
  });

  it("happy swaps the round eyes for upward arcs", () => {
    const { container } = render(<Mono mood="happy" />);
    expect(container.querySelectorAll('[data-eye="round"]').length).toBe(0);
    const arcs = [...container.querySelectorAll('[data-eye="arc"]')];
    expect(arcs.length).toBe(2);
    // Upward: the curve's control point sits above (smaller y than) its ends.
    for (const arc of arcs) {
      const [, endY, , controlY] = arc
        .getAttribute("d")!
        .match(/-?\d+(\.\d+)?/g)!
        .map(Number);
      expect(controlY).toBeLessThan(endY);
    }
    expect(container.querySelectorAll("[data-smile]").length).toBe(1);
  });

  it("is coloured only by semantic tokens — no raw colours", () => {
    for (const mood of ["idle", "happy"] as const) {
      const html = renderToStaticMarkup(<Mono mood={mood} />);
      expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(html).not.toMatch(/rgba?\(|hsla?\(|oklch\(/i);
      expect(html).not.toMatch(/\sstyle=/);
    }
    const { container } = render(<Mono />);
    const cls = (sel: string) =>
      container.querySelector(sel)!.getAttribute("class");
    const [body, screen] = [...container.querySelectorAll("svg > path")];
    expect(body.getAttribute("class")).toContain("fill-surface-muted");
    expect(body.getAttribute("class")).toContain("stroke-border");
    expect(screen.getAttribute("class")).toContain("fill-background");
    expect(cls('[data-eye="round"]')).toContain("fill-primary");
    expect(cls("[data-smile]")).toContain("stroke-primary");
  });

  it("stays a server component", () => {
    const src = readFileSync(join(__dirname, "mono.tsx"), "utf8");
    expect(src).not.toMatch(/^\s*["']use client["']/m);
  });
});
