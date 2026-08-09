import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The `--file-*` palette carries a 10px WHITE label (see FileTypeChip), so it
 * must clear WCAG AA for NORMAL text — 4.5:1 — not the 3:1 large-text
 * allowance. That is a tighter bound than `--status-*` lives under, because a
 * soft status pill puts coloured text on a tint whereas these put white text
 * on a solid fill.
 *
 * Colour picked by eye drifts light: brand reds and oranges look "right"
 * around L 0.6-0.65 and fail there. This test is what stops a future nudge
 * from silently costing legibility, and it reads the real tokens out of
 * globals.css so it cannot drift from what ships.
 */

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** oklch → linear sRGB → gamma-encoded sRGB (Björn Ottosson's matrices). */
function oklchToSrgb(
  L: number,
  C: number,
  H: number,
): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const bb = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.089484177 * a - 1.291485548 * bb;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const enc = (v: number) =>
    Math.min(
      1,
      Math.max(
        0,
        v <= 0.0031308
          ? 12.92 * v
          : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055,
      ),
    );
  return [enc(r), enc(g), enc(b)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast of pure white against the given fill. */
function contrastWithWhite(rgb: [number, number, number]): number {
  return 1.05 / (relativeLuminance(rgb) + 0.05);
}

/** Pull `--file-*: oklch(L C H)` declarations out of one theme block. */
function fileTokens(block: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  const re =
    /--file-([a-z]+):\s*oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)/g;
  for (const m of block.matchAll(re)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

const darkStart = CSS.indexOf(".dark {");
const lightBlock = CSS.slice(CSS.indexOf(":root {"), darkStart);
const darkBlock = CSS.slice(darkStart);

const THEMES = {
  light: fileTokens(lightBlock),
  dark: fileTokens(darkBlock),
};

describe("--file-* palette contrast", () => {
  it("defines the same seven tones in both themes", () => {
    const expected = [
      "pdf",
      "doc",
      "xls",
      "ppt",
      "zip",
      "media",
      "generic",
    ].sort();
    expect(Object.keys(THEMES.light).sort()).toEqual(expected);
    expect(Object.keys(THEMES.dark).sort()).toEqual(expected);
  });

  for (const [theme, tokens] of Object.entries(THEMES)) {
    it(`clears AA for white 10px label text in ${theme}`, () => {
      const failures: string[] = [];
      for (const [name, [L, C, H]] of Object.entries(tokens)) {
        const ratio = contrastWithWhite(oklchToSrgb(L, C, H));
        if (ratio < 4.5) {
          failures.push(`--file-${name} (${theme}) = ${ratio.toFixed(2)}:1`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});
