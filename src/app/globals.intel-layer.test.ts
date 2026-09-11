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
   * Second regression: ItemRow/SortableSubitemRow add `shadow-drag` (a real,
   * non-`none` shadow) alongside the intel classes while dragging. Plain
   * `.intel-match` fully REPLACES `box-shadow` (see the comment in
   * globals.css on why it can't safely compose with `--shadow-card`), which
   * would erase the drag elevation on a dragged matching row. `.intel-match`
   * combined with `.shadow-drag` must compose both shadows instead.
   */
  it("composes the drag elevation with the tone rule for a dragged matching row", () => {
    const utilities = extractLayerBlock("utilities");
    const match = utilities.match(/\.intel-match\.shadow-drag\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    const body = match![1];
    expect(body).toMatch(/inset 2px 0 0 var\(--intel-rule, transparent\)/);
    expect(body).toMatch(/var\(--shadow-drag\)/);
  });
});
