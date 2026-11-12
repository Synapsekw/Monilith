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

/**
 * Theme reach — `[data-theme-reach]` on <html> mixes a small share of --brand
 * into the content card, the raised surfaces and the hover fill (see the
 * "Theme reach" block in globals.css). The stylesheet mixes `in srgb`
 * precisely so this file can reproduce it: an sRGB color-mix of two opaque
 * colours is a per-channel linear interpolation of the gamma-encoded values.
 *
 * Mixing the brand in always moves a surface TOWARDS the text colour's
 * lightness (darker in light mode, lighter in dark mode), so reach can only
 * lower contrast — every text-on-surface check below is therefore re-run at
 * each level, for every preset block. The percentages are read from the
 * stylesheet, never restated here.
 */
const REACH_LEVELS = ["subtle", "tinted", "vivid"] as const;
type ReachLevel = (typeof REACH_LEVELS)[number];
type ReachToken = "--reach-content" | "--reach-surface" | "--reach-hover";

type Mode = "light" | "dark";

/** Every palette selector starts with `:root` (light) or `.dark`. */
function modeOf(selector: string): Mode {
  return selector.startsWith(".dark") ? "dark" : "light";
}

/**
 * The block that decides a reach token for a mode × level, mirroring the
 * cascade on <html>. Tinted is the default and lives in `:root`; subtle and
 * vivid have a block each. `--reach-content` alone is per-mode: `.dark`
 * redeclares the tinted value and `.dark[data-theme-reach="vivid"]` the vivid
 * one. Subtle is one block for both modes — it comes after `.dark` and wins.
 */
function reachSelector(
  level: ReachLevel,
  token: ReachToken,
  mode: Mode,
): string {
  if (level === "subtle") return '[data-theme-reach="subtle"]';
  const perMode = token === "--reach-content" && mode === "dark";
  if (level === "tinted") return perMode ? ".dark" : ":root";
  return perMode
    ? '.dark[data-theme-reach="vivid"]'
    : '[data-theme-reach="vivid"]';
}

function reachPct(level: ReachLevel, token: ReachToken, mode: Mode): number {
  const raw = declaration(reachSelector(level, token, mode), token);
  const m = raw.match(/^(\d+(?:\.\d+)?)%$/);
  if (!m) throw new Error(`${token} at ${level} is not a percentage: ${raw}`);
  return Number(m[1]);
}

/** `color-mix(in srgb, a pct%, b)` for two opaque colours. */
function mixSrgb(a: RGB, b: RGB, pct: number): RGB {
  const t = pct / 100;
  return a.map((c, i) => Math.round(t * c + (1 - t) * b[i])) as RGB;
}

/**
 * `color-mix(in srgb, a pct%, <b at bAlpha>)` composited over opaque `bg` —
 * the hover fill, whose seed (`--state-hover`) is alpha-on-parent. color-mix
 * interpolates PREMULTIPLIED channels and the alphas, so the result is a
 * translucent brand-leaning colour, not an opaque one.
 */
function mixSrgbOver(
  a: RGB,
  pct: number,
  b: RGB,
  bAlpha: number,
  bg: RGB,
): RGB {
  const t = pct / 100;
  const alpha = t + (1 - t) * bAlpha;
  if (alpha === 0) return bg;
  const colour = a.map(
    (c, i) => (t * c + (1 - t) * bAlpha * b[i]) / alpha,
  ) as RGB;
  return colour.map((c, i) =>
    Math.round(alpha * c + (1 - alpha) * bg[i]),
  ) as RGB;
}

/** `--state-hover` is `rgb(R G B / A%)` and is declared per MODE, not per preset. */
function stateHover(mode: "light" | "dark"): { rgb: RGB; alpha: number } {
  const raw = declaration(
    mode === "light" ? ":root" : ".dark",
    "--state-hover",
  );
  const m = raw.match(/^rgb\((\d+) (\d+) (\d+) \/ (\d+(?:\.\d+)?)%\)$/);
  if (!m) throw new Error(`--state-hover is not rgb(R G B / A%): ${raw}`);
  return {
    rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
    alpha: Number(m[4]) / 100,
  };
}

/** The peak alpha of each of the header glow's two radial gradients. */
function glowPeaks(): number[] {
  const start = CSS.indexOf(".content-glow::before {");
  if (start === -1) throw new Error("no .content-glow::before in globals.css");
  const body = CSS.slice(start, CSS.indexOf("}", start));
  const peaks = [
    ...body.matchAll(/var\(--brand(?:-2,\s*var\(--brand\))?\)\s+(\d+)%/g),
  ].map((m) => Number(m[1]) / 100);
  if (peaks.length !== 2) {
    throw new Error("the header glow must have exactly two brand stops");
  }
  return peaks;
}

/** Every seed the `--reach-surface` aliases tint (globals.css `@theme`). */
const RAISED_SURFACE_SEEDS = [
  "--surface",
  "--surface-muted",
  "--surface-sunken",
  "--card",
  "--popover",
  "--muted",
  "--accent",
  "--secondary",
] as const;

/** The content card as painted at a reach level. */
function contentCard(selector: string, level: ReachLevel): RGB {
  return mixSrgb(
    hex(declaration(selector, "--brand")),
    hex(declaration(selector, "--content-surface")),
    reachPct(level, "--reach-content", modeOf(selector)),
  );
}

/** A raised surface as painted at a reach level. */
function raised(selector: string, seed: string, level: ReachLevel): RGB {
  return mixSrgb(
    hex(declaration(selector, "--brand")),
    hex(declaration(selector, seed)),
    reachPct(level, "--reach-surface", modeOf(selector)),
  );
}

/** A hovered row on `bg` at a reach level. */
function hovered(
  selector: string,
  mode: "light" | "dark",
  level: ReachLevel,
  bg: RGB,
): RGB {
  const { rgb, alpha } = stateHover(mode);
  return mixSrgbOver(
    hex(declaration(selector, "--brand")),
    reachPct(level, "--reach-hover", mode),
    rgb,
    alpha,
    bg,
  );
}

describe("mixSrgb", () => {
  it("is a per-channel linear mix: 0% is the base, 100% the tint", () => {
    expect(mixSrgb([255, 0, 0], [0, 0, 255], 0)).toEqual([0, 0, 255]);
    expect(mixSrgb([255, 0, 0], [0, 0, 255], 100)).toEqual([255, 0, 0]);
    expect(mixSrgb([200, 100, 0], [0, 100, 200], 50)).toEqual([100, 100, 100]);
    expect(mixSrgb([90, 110, 213], [255, 255, 255], 5)).toEqual([
      247, 248, 253,
    ]);
  });

  it("at 0% the alpha variant is exactly the untouched hover fill", () => {
    // rgb(0 0 0 / 4%) over white, the pre-reach light hover.
    expect(
      mixSrgbOver([90, 110, 213], 0, [0, 0, 0], 0.04, [255, 255, 255]),
    ).toEqual(over([0, 0, 0], 0.04, [255, 255, 255]));
  });
});

describe("reach levels", () => {
  it("subtle is the identity — every derived surface equals its seed", () => {
    for (const selector of [...LIGHT_SELECTORS, ...DARK_SELECTORS]) {
      expect(contentCard(selector, "subtle"), selector).toEqual(
        hex(declaration(selector, "--content-surface")),
      );
      for (const seed of RAISED_SURFACE_SEEDS) {
        expect(raised(selector, seed, "subtle"), `${selector} ${seed}`).toEqual(
          hex(declaration(selector, seed)),
        );
      }
    }
  });

  it("each token is monotonic in both modes: subtle ≤ tinted ≤ vivid", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const token of [
        "--reach-content",
        "--reach-surface",
        "--reach-hover",
      ] as const) {
        const [s, t, v] = REACH_LEVELS.map((l) => reachPct(l, token, mode));
        expect(s, `${mode} ${token}`).toBe(0);
        expect(t, `${mode} ${token}`).toBeGreaterThanOrEqual(s);
        expect(v, `${mode} ${token}`).toBeGreaterThanOrEqual(t);
      }
    }
  });

  it("only --reach-content is per-mode, and dark carries more than light", () => {
    for (const level of ["tinted", "vivid"] as const) {
      expect(reachPct(level, "--reach-content", "dark")).toBeGreaterThan(
        reachPct(level, "--reach-content", "light"),
      );
    }
    // The dark blocks redeclare nothing else, so the other tokens cannot
    // silently diverge between modes.
    expect(blockOf(".dark").match(/--reach-[a-z]+(?=:)/g)).toEqual([
      "--reach-content",
    ]);
    expect(
      blockOf('.dark[data-theme-reach="vivid"]').match(/--reach-[a-z]+(?=:)/g),
    ).toEqual(["--reach-content"]);
  });

  it("orders the blocks so the cascade resolves mode × reach on <html>", () => {
    // `.dark`, the subtle block and the vivid block all carry one class or
    // attribute, so the reach blocks beat `.dark` only by coming AFTER it —
    // which is what makes `.dark[data-theme-reach="subtle"]` resolve to 0%.
    // `.dark[data-theme-reach="vivid"]` then out-ranks the vivid block.
    const at = (s: string) => CSS.indexOf(`\n${s} {`);
    const dark = at(".dark");
    expect(dark).toBeGreaterThan(at(":root"));
    expect(at('[data-theme-reach="subtle"]')).toBeGreaterThan(dark);
    expect(at('[data-theme-reach="vivid"]')).toBeGreaterThan(dark);
    expect(at('.dark[data-theme-reach="vivid"]')).toBeGreaterThan(
      at('[data-theme-reach="vivid"]'),
    );
    // Nothing more specific may redeclare subtle away from zero.
    expect(CSS).not.toMatch(/\.dark\[data-theme-reach="subtle"\]/);
  });
});

describe.each(LIGHT_SELECTORS)(
  "muted text clears WCAG AA on the wash — light %s",
  (selector) => {
    const fg = hex(declaration(selector, "--muted-foreground"));

    it.each(washStops(selector))("clears AA on the %s stop", (stop) => {
      expect(contrast(fg, hex(stop))).toBeGreaterThanOrEqual(AA);
    });

    it.each(REACH_LEVELS)(
      "clears AA on the content card and on --surface-muted at reach %s",
      (level) => {
        expect(
          contrast(fg, contentCard(selector, level)),
        ).toBeGreaterThanOrEqual(AA);
        expect(
          contrast(fg, raised(selector, "--surface-muted", level)),
        ).toBeGreaterThanOrEqual(AA);
      },
    );
  },
);

/**
 * The full reach matrix: both secondary text colours, on every surface reach
 * tints, at every level, in every block. Three situations beyond the resting
 * surface are covered because each stacks more brand under the text:
 *   - a hovered row (`bg-state-hover`) on the content card and on every raised
 *     surface;
 *   - the header glow at its peak, which only exists at vivid.
 */
describe.each([
  ...LIGHT_SELECTORS.map((s) => [s, "light"] as const),
  ...DARK_SELECTORS.map((s) => [s, "dark"] as const),
])("text clears WCAG AA on reach-tinted surfaces — %s", (selector, mode) => {
  const brand = hex(declaration(selector, "--brand"));

  describe.each(["--muted-foreground", "--kicker"] as const)("%s", (token) => {
    const fg = hex(declaration(selector, token));

    describe.each(REACH_LEVELS)("at reach %s", (level) => {
      it("on the content card", () => {
        expect(
          contrast(fg, contentCard(selector, level)),
        ).toBeGreaterThanOrEqual(AA);
      });

      it.each(RAISED_SURFACE_SEEDS)("on %s", (seed) => {
        expect(
          contrast(fg, raised(selector, seed, level)),
        ).toBeGreaterThanOrEqual(AA);
      });

      it("on a hovered row on the content card", () => {
        expect(
          contrast(
            fg,
            hovered(selector, mode, level, contentCard(selector, level)),
          ),
        ).toBeGreaterThanOrEqual(AA);
      });

      // The binding case. A hover fill is alpha-on-parent, so on a raised
      // surface the text sits on TWO doses of brand. Light `--surface-muted`
      // is the tightest parent in every preset: the spec's starting vivid
      // values (surface 7%, hover 13%) measured 4.12–4.40 here and were
      // lowered to 5% / 8% — see the "Theme reach" comment in globals.css.
      it.each(RAISED_SURFACE_SEEDS)("on a hovered row on %s", (seed) => {
        expect(
          contrast(
            fg,
            hovered(selector, mode, level, raised(selector, seed, level)),
          ),
        ).toBeGreaterThanOrEqual(AA);
      });
    });

    it("on the content card under the header glow at its peak (vivid)", () => {
      // Conservative: both gradients at full strength on the same pixel, which
      // their geometry never produces. --brand-2 falls back to --brand.
      const lit = glowPeaks().reduce<RGB>(
        (bg, peak) => over(brand, peak, bg),
        contentCard(selector, "vivid"),
      );
      expect(contrast(fg, lit)).toBeGreaterThanOrEqual(AA);
    });
  });
});

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

    it.each(REACH_LEVELS)(
      "clears AA on the content card at reach %s",
      (level) => {
        expect(
          contrast(fg, contentCard(selector, level)),
        ).toBeGreaterThanOrEqual(AA);
      },
    );
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
    // Reach tints the card with the brand, which in light mode DARKENS it
    // towards the chrome. This floor is what caps light --reach-content (see
    // the "Theme reach" comment in globals.css) — far below the dark values.
    it.each(REACH_LEVELS)(
      "bloomed header band vs the content card ≥ 1.15:1 at reach %s",
      (level) => {
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
        const band = over(
          src,
          Number(pm[2]) / 100,
          hex(washStops(selector)[0]),
        );
        expect(
          contrast(band, contentCard(selector, level)),
        ).toBeGreaterThanOrEqual(1.15);
      },
    );
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

    // Reach tints the card WITH the brand, so the mark and its ground converge.
    it.each(REACH_LEVELS)(
      "the brand is a visible non-text mark on the content card (≥3:1) at reach %s",
      (level) => {
        expect(
          contrast(
            hex(declaration(selector, "--brand")),
            contentCard(selector, level),
          ),
        ).toBeGreaterThanOrEqual(3);
      },
    );

    it.each(REACH_LEVELS)(
      "body text clears 7:1 on --surface and on the content card at reach %s",
      (level) => {
        const fg = hex(declaration(selector, "--foreground"));
        expect(
          contrast(fg, raised(selector, "--surface", level)),
        ).toBeGreaterThanOrEqual(7);
        expect(
          contrast(fg, contentCard(selector, level)),
        ).toBeGreaterThanOrEqual(7);
      },
    );
  },
);
