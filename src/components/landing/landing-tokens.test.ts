import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Grep guard: the landing hero (CSS module + its shallow tsx siblings) used
 * to hardcode the dark-first brand/zinc hexes directly, so it never inverted
 * for the light theme. Everything here must read from CSS custom properties
 * instead — this test fails on any hex or rgb()/rgba() literal reintroduced
 * into those files.
 *
 * Deliberately non-recursive (`src/components/landing/*.tsx`, not
 * `sections/**`) — matches the scope of Task 6 (Track F).
 */

const LANDING_DIR = resolve(process.cwd(), "src/components/landing");
const HERO_CSS = join(LANDING_DIR, "monolith-hero.module.css");

// 3/4/6/8-hex-digit colors, but not a fragment id like `#features` — the
// negative lookahead stops `#fea` (from `href="#features"`) from matching:
// after the shortest hex run there'd still be an alnum character following.
const HEX_RE =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-z])/i;
// Word-boundary so `hexToRgb(` (a function name) doesn't match.
const RGB_RE = /\brgba?\(/i;

function landingTsxFiles(): string[] {
  return readdirSync(LANDING_DIR)
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .map((f) => join(LANDING_DIR, f));
}

describe("landing hex/rgba guard", () => {
  it("monolith-hero.module.css has no hardcoded hex or rgb()/rgba() literal", () => {
    const css = readFileSync(HERO_CSS, "utf8");
    expect(css).not.toMatch(HEX_RE);
    expect(css).not.toMatch(RGB_RE);
  });

  it("landing components have no hardcoded hex or rgb()/rgba() literal", () => {
    for (const file of landingTsxFiles()) {
      const content = readFileSync(file, "utf8");
      expect(content, `${file} contains a hex color literal`).not.toMatch(
        HEX_RE,
      );
      expect(content, `${file} contains an rgb()/rgba() literal`).not.toMatch(
        RGB_RE,
      );
    }
  });
});
