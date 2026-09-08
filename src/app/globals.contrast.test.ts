import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_THEME_PRESET, THEME_PRESET_IDS } from "@/lib/theme/presets";

const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * WCAG AA for the dominant muted text ON THE WASH.
 *
 * This is the machine-checkable half of follow-up #3. It reads the shipped
 * values out of globals.css — the wash stops, the bloom alpha and
 * --muted-foreground — and recomputes contrast, so the numbers can never drift
 * away from the stylesheet the way a comment would.
 *
 * WHAT IT DOES NOT PROVE: that the resulting grey still reads as "muted"
 * rather than as body text. That is an eye judgement and belongs to the
 * visual pass, not here.
 *
 * Direction of the bloom matters and is why the two themes have different
 * worst cases:
 *   - light bloom is WHITE, so it lightens the surface and RAISES contrast
 *     against dark text → worst case is the darkest stop, bloom ignored.
 *   - dark bloom is --brand, so it lightens the surface and LOWERS contrast
 *     against light text → worst case is the lightest stop at full bloom.
 *
 * Every describe below is parameterized over the theme-preset override blocks
 * as well as the base palette: a preset re-seeds exactly the tokens these
 * checks read, so a new preset that ships a too-pale grey fails here rather
 * than in a user's eyes.
 */
const AA = 4.5;

const OVERRIDE_PRESETS = THEME_PRESET_IDS.filter(
  (id) => id !== DEFAULT_THEME_PRESET,
);
/** `:root` (keystone) plus one selector per preset override block. */
const LIGHT_SELECTORS = [
  ":root",
  ...OVERRIDE_PRESETS.map((id) => `:root[data-theme-preset="${id}"]`),
];
const DARK_SELECTORS = [
  ".dark",
  ...OVERRIDE_PRESETS.map((id) => `.dark[data-theme-preset="${id}"]`),
];

function blockOf(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  return CSS.slice(start, CSS.indexOf("\n}", start));
}

function declaration(selector: string, token: string): string {
  const m = blockOf(selector).match(
    new RegExp(`^\\s{2}${token}:\\s*([^;]+);`, "m"),
  );
  if (!m) throw new Error(`${token} not declared in ${selector}`);
  return m[1].trim();
}

type RGB = [number, number, number];

function hex(h: string): RGB {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
}

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Source-over composite of `fg` at `alpha` onto opaque `bg`. */
function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i])) as RGB;
}

/** Every colour stop of a `linear-gradient(...)` declaration. */
function washStops(selector: string): string[] {
  const stops = declaration(selector, "--app-wash").match(/#[0-9a-f]{6}/gi);
  if (!stops || stops.length < 2) {
    throw new Error(`--app-wash in ${selector} has no parseable stops`);
  }
  return stops;
}

/** The declared peak of `color-mix(in oklab, var(--brand) N%, transparent)`. */
function darkBloomPeak(selector: string): number {
  const m = declaration(selector, "--app-bloom").match(
    /var\(--brand\)\s+(\d+)%/,
  );
  if (!m) throw new Error(`could not read the bloom percentage in ${selector}`);
  return Number(m[1]) / 100;
}

describe.each(LIGHT_SELECTORS)(
  "muted text clears WCAG AA on the wash — light %s",
  (selector) => {
    const fg = hex(declaration(selector, "--muted-foreground"));

    it.each(washStops(selector))("clears AA on the %s stop", (stop) => {
      expect(contrast(fg, hex(stop))).toBeGreaterThanOrEqual(AA);
    });

    it("clears AA on the content card and on --surface-muted", () => {
      expect(
        contrast(fg, hex(declaration(selector, "--content-surface"))),
      ).toBeGreaterThanOrEqual(AA);
      expect(
        contrast(fg, hex(declaration(selector, "--surface-muted"))),
      ).toBeGreaterThanOrEqual(AA);
    });
  },
);

describe.each(DARK_SELECTORS)(
  "muted text clears WCAG AA on the wash — dark %s",
  (selector) => {
    const fg = hex(declaration(selector, "--muted-foreground"));
    const brand = hex(declaration(selector, "--brand"));
    const bloomPeak = darkBloomPeak(selector);

    it.each(washStops(selector))(
      "clears AA on the %s stop, unbloomed",
      (stop) => {
        expect(contrast(fg, hex(stop))).toBeGreaterThanOrEqual(AA);
      },
    );

    it.each(washStops(selector))(
      "clears AA on the %s stop under the bloom at its declared peak",
      (stop) => {
        expect(
          contrast(fg, over(brand, bloomPeak, hex(stop))),
        ).toBeGreaterThanOrEqual(AA);
      },
    );

    it("clears AA on the content card", () => {
      expect(
        contrast(fg, hex(declaration(selector, "--content-surface"))),
      ).toBeGreaterThanOrEqual(AA);
    });
  },
);

describe.each(LIGHT_SELECTORS)(
  "kicker text clears WCAG AA on the wash — light %s",
  (selector) => {
    const fg = hex(declaration(selector, "--kicker"));
    it.each(washStops(selector))("clears AA on the %s stop", (stop) => {
      expect(contrast(fg, hex(stop))).toBeGreaterThanOrEqual(AA);
    });
  },
);

describe.each(DARK_SELECTORS)(
  "kicker text clears WCAG AA on the wash — dark %s",
  (selector) => {
    const fg = hex(declaration(selector, "--kicker"));
    const brand = hex(declaration(selector, "--brand"));
    const bloomPeak = darkBloomPeak(selector);
    it.each(washStops(selector))(
      "clears AA on the %s stop under the bloom",
      (stop) => {
        expect(
          contrast(fg, over(brand, bloomPeak, hex(stop))),
        ).toBeGreaterThanOrEqual(AA);
      },
    );
  },
);

describe.each(LIGHT_SELECTORS)(
  "light chrome separates from the content card — %s",
  (selector) => {
    // The bloom source is `color-mix(in oklab, var(--brand) P%, white)` at alpha A
    // over the FIRST wash stop (top-left is where the header band lives).
    // Approximate the oklab mix with an sRGB mix — conservative for this check.
    it("bloomed header band vs --content-surface ≥ 1.15:1", () => {
      const bloom = declaration(selector, "--app-bloom");
      const pm = bloom.match(
        /var\(--brand\)\s+(\d+)%,\s*white\)\s*\/?\s*(\d+)%/,
      );
      if (!pm)
        throw new Error(
          "light bloom must be color-mix(in oklab, var(--brand) P%, white) / A%",
        );
      const brand = hex(declaration(selector, "--brand"));
      const src = over(brand, Number(pm[1]) / 100, [255, 255, 255]);
      const band = over(src, Number(pm[2]) / 100, hex(washStops(selector)[0]));
      const card = hex(declaration(selector, "--content-surface"));
      expect(contrast(band, card)).toBeGreaterThanOrEqual(1.15);
    });
  },
);

/**
 * Palette-wide floors that must hold in EVERY block, base or preset. These are
 * what a hand-picked preset accent is most likely to break: a brand light
 * enough to look pretty on the wash stops failing its own button label, or a
 * body/surface pair that drifts below the AAA-ish floor the monochrome system
 * relies on for dense board text.
 */
describe.each([...LIGHT_SELECTORS, ...DARK_SELECTORS])(
  "palette floors — %s",
  (selector) => {
    it("brand button label clears AA on the brand fill", () => {
      expect(
        contrast(
          hex(declaration(selector, "--brand-foreground")),
          hex(declaration(selector, "--brand")),
        ),
      ).toBeGreaterThanOrEqual(AA);
    });

    it("the brand is a visible non-text mark on the content card (≥3:1)", () => {
      expect(
        contrast(
          hex(declaration(selector, "--brand")),
          hex(declaration(selector, "--content-surface")),
        ),
      ).toBeGreaterThanOrEqual(3);
    });

    it("body text clears 7:1 on --surface", () => {
      expect(
        contrast(
          hex(declaration(selector, "--foreground")),
          hex(declaration(selector, "--surface")),
        ),
      ).toBeGreaterThanOrEqual(7);
    });
  },
);
