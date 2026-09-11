import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * Locks the fix for the Kanban cascade regression: `.intel-match` /
 * `.intel-miss` must live in `@layer utilities`, not `@layer base`.
 *
 * Tailwind's own layer order (from `@import "tailwindcss"`) is
 * theme, base, components, utilities. A `base`-layer rule ALWAYS loses to a
 * same-property utility class on the same element — regardless of
 * specificity or source order — so a `base`-layer `.intel-match` box-shadow
 * is silently overridden by Kanban's `shadow-card` utility and never
 * renders. jsdom doesn't apply stylesheets (no cascade layers support), so
 * this reads the source text directly rather than relying on computed
 * styles in a component test.
 */
function extractLayerBlock(layerName: string): string {
  const marker = `@layer ${layerName} {`;
  const start = CSS.indexOf(marker);
  if (start === -1) {
    throw new Error(`no "@layer ${layerName}" block found in globals.css`);
  }
  let i = start + marker.length;
  let depth = 1;
  while (depth > 0 && i < CSS.length) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}") depth--;
    i++;
  }
  return CSS.slice(start, i);
}

describe("Board Intelligence row rule wins the cascade", () => {
  it("declares .intel-match and .intel-miss inside @layer utilities", () => {
    const utilities = extractLayerBlock("utilities");
    expect(utilities).toMatch(/\.intel-match\s*\{/);
    expect(utilities).toMatch(/\.intel-miss\s*\{/);
  });

  it("does not declare .intel-match or .intel-miss inside @layer base", () => {
    const base = extractLayerBlock("base");
    expect(base).not.toMatch(/\.intel-match\s*\{/);
    expect(base).not.toMatch(/\.intel-miss\s*\{/);
  });

  /**
   * Second regression: the rule must be a PSEUDO-ELEMENT, not an `inset`
   * box-shadow. An inset shadow paints on the element's own background —
   * below every child — and the first child of a table row (`NameCell`) and
   * of a gantt row (`GanttRowItem`'s label) is a `sticky left-0 z-10` column
   * with an opaque background flush at x=0, so the 2px strip was completely
   * covered in Table and Timeline. `::after` with a `z-index` above those
   * z-10 frozen columns is what makes it visible in every view.
   */
  it("paints the rule as an ::after strip above the frozen name column", () => {
    const utilities = extractLayerBlock("utilities");
    const after = utilities.match(/\.intel-match::after\s*\{([^}]*)\}/);
    expect(after).not.toBeNull();
    const body = after![1];
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/width:\s*2px/);
    expect(body).toMatch(/background:\s*var\(--intel-rule, transparent\)/);
    const z = body.match(/z-index:\s*(\d+)/);
    expect(z).not.toBeNull();
    expect(Number(z![1])).toBeGreaterThan(10);

    // …anchored by `position: relative` on the row root itself.
    const root = utilities.match(/\.intel-match\s*\{([^}]*)\}/);
    expect(root).not.toBeNull();
    expect(root![1]).toMatch(/position:\s*relative/);
  });

  /**
   * And the row's own `box-shadow` is left alone, so a dragged matching row
   * keeps its `shadow-drag` elevation with no composed override needed.
   */
  it("never touches box-shadow, so shadow-drag survives on a dragged row", () => {
    const utilities = extractLayerBlock("utilities");
    expect(utilities).not.toMatch(/\.intel-match\.shadow-drag\s*\{/);
    const root = utilities.match(/\.intel-match\s*\{([^}]*)\}/);
    expect(root![1]).not.toMatch(/box-shadow/);
  });
});
