import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Grep guard: the landing must not scatter colour literals through its
 * components or layout rules. The editorial landing is dark-locked and carries
 * its own charcoal/cobalt palette (approved design, not the app theme), so the
 * ONE sanctioned place for a hex literal is a custom-property declaration
 * (`--token: #hex;`) at the top of the CSS module. Every other rule must read
 * `var(--token)`; the .tsx files may carry no colour literal at all.
 *
 * Deliberately non-recursive (`src/components/landing/*.tsx`, not `captures/`).
 */

const LANDING_DIR = resolve(process.cwd(), "src/components/landing");
const LANDING_CSS = join(LANDING_DIR, "editorial-landing.module.css");

// 3/4/6/8-hex-digit colors, but not a fragment id like `#product` — the
// negative lookahead stops `#pro` from matching: after the shortest hex run
// there'd still be an alnum character following.
const HEX_RE =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-z])/i;
// Word-boundary so `hexToRgb(` (a function name) doesn't match.
const RGB_RE = /\brgba?\(/i;
const TOKEN_DECL_RE = /^\s*--[\w-]+:\s*#[0-9a-f]{3,8};\s*$/i;

function landingTsxFiles(): string[] {
  return readdirSync(LANDING_DIR)
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .map((f) => join(LANDING_DIR, f));
}

describe("landing hex/rgba guard", () => {
  it("the CSS module's only hex literals are custom-property declarations", () => {
    const lines = readFileSync(LANDING_CSS, "utf8").split("\n");
    const declarations = lines.filter((l) => TOKEN_DECL_RE.test(l));
    expect(declarations.length).toBeGreaterThan(0);
    for (const line of lines) {
      if (TOKEN_DECL_RE.test(line)) continue;
      expect(line, `stray colour literal: ${line.trim()}`).not.toMatch(HEX_RE);
      expect(line, `stray rgb() literal: ${line.trim()}`).not.toMatch(RGB_RE);
    }
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
