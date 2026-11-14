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
 * Both modes now put LIGHT text on a DARK chrome, so the bloom works against
 * the text in both — it lightens the ground and LOWERS contrast, and the worst
 * case is a stop at full bloom:
 *   - dark bloom is the accent itself at low alpha, under the mode's own
 *     light-grey --muted-foreground;
 *   - light is the BOLD FRAME: a saturated wash under a bright tint of each
 *     accent (a glow, mostly accent), and the text on it is white — the generic tokens are re-seeded
 *     inside `.chrome-scope` (see "bold frame chrome text" below). The light
 *     palette's own dark greys never meet the wash any more; they are checked
 *     on the content card and the raised surfaces only.
 *
 * The bloom is a MESH of three radials, one per accent stop (--brand,
 * --brand-2, --brand-mid), declared once per mode in `:root` / `.dark` and
 * never in a preset block — so the geometry and alphas are read from the mode
 * block and the colours from the palette block under test. See `bloomed`.
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

/** `--brand-mid` is derived, not seeded: `color-mix(in srgb, --brand, --brand-2)`. */
const BRAND_MID_RECIPE = "color-mix(in srgb, var(--brand), var(--brand-2))";

/** `color-mix(in srgb, a pct%, b)` for two opaque colours. */
function mixSrgb(a: RGB, b: RGB, pct: number): RGB {
  const t = pct / 100;
  return a.map((c, i) => Math.round(t * c + (1 - t) * b[i])) as RGB;
}

/** Does this block declare the token itself (rather than inherit it)? */
function declares(selector: string, token: string): boolean {
  return new RegExp(`^\\s{2}${token}:`, "m").test(blockOf(selector));
}

/**
 * The three bloom colours of a palette block, in the radials' declaration
 * order: --brand, --brand-2, --brand-mid. The middle is the `:root` recipe
 * unless the block seeds its own (only Prism does).
 */
function bloomColours(selector: string): RGB[] {
  const a = hex(declaration(selector, "--brand"));
  const b = hex(declaration(selector, "--brand-2"));
  // `:root` declares the recipe itself; a preset block either inherits it or
  // seeds a literal.
  const own = declares(selector, "--brand-mid")
    ? declaration(selector, "--brand-mid")
    : BRAND_MID_RECIPE;
  const mid = own === BRAND_MID_RECIPE ? mixSrgb(a, b, 50) : hex(own);
  return [a, b, mid];
}

/** One bloom radial: an ellipse in fractions of the `.app-wash` box. */
type BloomRadial = {
  /** Horizontal and vertical radius of the ending shape. */
  rx: number;
  ry: number;
  /** Centre. */
  cx: number;
  cy: number;
  /** Declared alpha at the centre. */
  peak: number;
  /** Where the radial reaches `transparent`, as a fraction of the radius. */
  reach: number;
};

/** A light radial also tints its accent towards white: `tint`% accent. */
type LightBloomRadial = BloomRadial & { tint: number };

const PCT = "(-?\\d+(?:\\.\\d+)?)%";
/** The colour stop of one radial, per mode. Dark is the accent itself at an
 *  alpha; light is a tint of the accent towards white, at an alpha. Both
 *  capture the accent suffix first and the alpha last; light captures the
 *  tint in between. */
const BLOOM_COLOUR: Record<Mode, string> = {
  dark: `color-mix\\(in srgb, var\\(--brand(-2|-mid)?\\) ${PCT}, transparent\\)`,
  light:
    `color-mix\\(\\s*in srgb,\\s*color-mix\\(in srgb, var\\(--brand(-2|-mid)?\\) ${PCT}, white\\) ${PCT},` +
    `\\s*transparent\\s*\\)`,
};

/**
 * The bloom radials of a mode, in declaration order — each is
 * `radial-gradient(RX% RY% at CX% CY%, <colour> 0%, transparent T%)`, where
 * `<colour>` is `BLOOM_COLOUR[mode]`. Declared per MODE (`:root` / `.dark`),
 * not per preset. The regex is strict on purpose: a radial written any other
 * way is not silently skipped, it fails the three-radial check below.
 */
function bloomRadials(mode: "dark"): BloomRadial[];
function bloomRadials(mode: "light"): LightBloomRadial[];
function bloomRadials(mode: Mode): BloomRadial[] {
  const radials = [
    ...declaration(mode === "dark" ? ".dark" : ":root", "--app-bloom").matchAll(
      new RegExp(
        `radial-gradient\\(\\s*${PCT} ${PCT} at ${PCT} ${PCT},\\s*` +
          `${BLOOM_COLOUR[mode]}\\s*0%,\\s*` +
          `transparent ${PCT}\\s*\\)`,
        "g",
      ),
    ),
  ];
  if (radials.map((m) => m[5] ?? "").join() !== ",-2,-mid") {
    throw new Error(
      `the ${mode} bloom must be three radials: --brand, --brand-2, --brand-mid`,
    );
  }
  return radials.map((m) => {
    // Groups after the accent suffix: dark = alpha, reach; light = tint,
    // alpha, reach.
    const rest = m.slice(6).map(Number);
    const geometry = {
      rx: Number(m[1]) / 100,
      ry: Number(m[2]) / 100,
      cx: Number(m[3]) / 100,
      cy: Number(m[4]) / 100,
    };
    return mode === "dark"
      ? { ...geometry, peak: rest[0] / 100, reach: rest[1] / 100 }
      : {
          ...geometry,
          tint: rest[0],
          peak: rest[1] / 100,
          reach: rest[2] / 100,
        };
  });
}

const darkBloomRadials = () => bloomRadials("dark");
const lightBloomRadials = () => bloomRadials("light");

/**
 * Which radials can light the SAME pixel: every maximal set of radial indices
 * whose lit ellipses intersect inside the box, found by sampling the box on a
 * 0.5% grid. The radii and centres are percentages of the box, so the answer
 * does not depend on the viewport's aspect ratio.
 *
 * This is what decides how the peaks stack below. It is read off the declared
 * geometry rather than assumed: move a radial so that it overlaps another and
 * the stacked ground appears in every check on its own.
 */
function overlappingBloomRadials(radials: BloomRadial[]): number[][] {
  const STEPS = 200;
  const masks = new Set<number>();
  for (let i = 0; i <= STEPS; i++) {
    for (let j = 0; j <= STEPS; j++) {
      const [x, y] = [i / STEPS, j / STEPS];
      let mask = 0;
      radials.forEach((r, n) => {
        if (Math.hypot((x - r.cx) / r.rx, (y - r.cy) / r.ry) < r.reach) {
          mask |= 1 << n;
        }
      });
      if (mask) masks.add(mask);
    }
  }
  return [...masks]
    .filter((m) => ![...masks].some((o) => o !== m && (o & m) === m))
    .sort((a, b) => a - b)
    .map((m) => radials.map((_, n) => n).filter((n) => m & (1 << n)));
}

const WHITE: RGB = [255, 255, 255];

const bloomGroups: Partial<Record<Mode, number[][]>> = {};

/**
 * Every worst-case chrome ground a wash stop can become under the bloom: one
 * per set of radials that can light the same pixel, with every radial of the
 * set STACKED at its full declared peak — conservative twice over, since the
 * peaks sit at the centres (the first one is outside the box) and the
 * lightest wash stop is not under every radial.
 *
 * The painted colour of a radial is the accent itself in dark, and in light
 * the accent tinted towards white by the radial's declared `tint`
 * (`color-mix(in srgb, accent T%, white)`).
 *
 * Today the three lit ellipses are disjoint in both modes (top-left,
 * bottom-right, lower-left: the first ends at 43% of the height on the left
 * edge, the third starts at 56%), so this is three grounds — the sidebar under
 * radial 1, the sidebar under radial 3, the dock side under radial 2.
 */
function bloomed(selector: string, stop: string): Array<[string, RGB]> {
  const mode = modeOf(selector);
  const accents = bloomColours(selector);
  const light = mode === "light" ? lightBloomRadials() : null;
  const radials: BloomRadial[] = light ?? darkBloomRadials();
  const colours = light
    ? accents.map((c, n) => mixSrgb(c, WHITE, light[n].tint))
    : accents;
  const groups = (bloomGroups[mode] ??= overlappingBloomRadials(radials));
  return groups.map((group) => [
    `bloom radial ${group.map((n) => n + 1).join("+")}`,
    group.reduce<RGB>(
      (bg, n) => over(colours[n], radials[n].peak, bg),
      hex(stop),
    ),
  ]);
}

/** `bloomed` for a `.dark` palette block. */
function darkBloomed(selector: string, stop: string): Array<[string, RGB]> {
  if (modeOf(selector) !== "dark") throw new Error(`${selector} is not dark`);
  return bloomed(selector, stop);
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
type ReachToken =
  "--reach-content" | "--reach-surface" | "--reach-hover" | "--reach-selected";

type Mode = "light" | "dark";

/** Every palette selector starts with `:root` (light) or `.dark`. */
function modeOf(selector: string): Mode {
  return selector.startsWith(".dark") ? "dark" : "light";
}

const DARK_VIVID = '.dark[data-theme-reach="vivid"]';

/**
 * The block that decides a reach token for a mode × level, mirroring the
 * cascade on <html>. Tinted is the default and lives in `:root`; subtle and
 * vivid have a block each. Dark overrides ride more specific blocks and are
 * read off the stylesheet, not restated: `.dark` redeclares the tinted
 * `--reach-content`, and `.dark[data-theme-reach="vivid"]` whichever vivid
 * tokens it lists (content and surface). Subtle is one block for both modes —
 * it comes after `.dark` and wins.
 */
function reachSelector(
  level: ReachLevel,
  token: ReachToken,
  mode: Mode,
): string {
  if (level === "subtle") return '[data-theme-reach="subtle"]';
  if (level === "tinted") {
    return mode === "dark" && declares(".dark", token) ? ".dark" : ":root";
  }
  return mode === "dark" && declares(DARK_VIVID, token)
    ? DARK_VIVID
    : '[data-theme-reach="vivid"]';
}

function reachPct(level: ReachLevel, token: ReachToken, mode: Mode): number {
  const raw = declaration(reachSelector(level, token, mode), token);
  const m = raw.match(/^(\d+(?:\.\d+)?)%$/);
  if (!m) throw new Error(`${token} at ${level} is not a percentage: ${raw}`);
  return Number(m[1]);
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
        "--reach-selected",
      ] as const) {
        const [s, t, v] = REACH_LEVELS.map((l) => reachPct(l, token, mode));
        expect(s, `${mode} ${token}`).toBe(0);
        expect(t, `${mode} ${token}`).toBeGreaterThanOrEqual(s);
        expect(v, `${mode} ${token}`).toBeGreaterThanOrEqual(t);
      }
    }
  });

  it("dark overrides exactly content (tinted, vivid) and surface (vivid), and carries more than light", () => {
    for (const level of ["tinted", "vivid"] as const) {
      expect(reachPct(level, "--reach-content", "dark")).toBeGreaterThan(
        reachPct(level, "--reach-content", "light"),
      );
    }
    expect(reachPct("vivid", "--reach-surface", "dark")).toBeGreaterThan(
      reachPct("vivid", "--reach-surface", "light"),
    );
    // The dark blocks redeclare nothing else, so the other tokens cannot
    // silently diverge between modes. Dark vivid carries --reach-surface as
    // well: the raised surfaces have to climb WITH the content card or they
    // sink into it (see "raised surfaces stay off the content card" below).
    expect(blockOf(".dark").match(/--reach-[a-z]+(?=:)/g)).toEqual([
      "--reach-content",
    ]);
    expect(blockOf(DARK_VIVID).match(/--reach-[a-z]+(?=:)/g)).toEqual([
      "--reach-content",
      "--reach-surface",
    ]);
  });

  it("dark vivid stays stronger than dark tinted, on the card and on raised surfaces", () => {
    // Fixing the flattened cards must not be done by quietly turning Vivid
    // into Tinted-with-a-glow: both dark mixes keep at least two percentage
    // points over their tinted value.
    for (const token of ["--reach-content", "--reach-surface"] as const) {
      expect(
        reachPct("vivid", token, "dark") - reachPct("tinted", token, "dark"),
        token,
      ).toBeGreaterThanOrEqual(2);
    }
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
    expect(at(DARK_VIVID)).toBeGreaterThan(at('[data-theme-reach="vivid"]'));
    // Nothing more specific may redeclare subtle away from zero: the one
    // dark-subtle block carries the pre-reach chart greys and no reach token.
    expect(blockOf('.dark[data-theme-reach="subtle"]')).not.toMatch(/--reach-/);
    expect(
      CSS.match(/\.dark\[data-theme-reach="subtle"\][^{]*\{/g),
    ).toHaveLength(1);
  });
});

/**
 * Raised surfaces vs the content card they sit on. The seeds put `--surface` /
 * `--card` about 1.07:1 above the dark content card; reach mixes the brand
 * into BOTH, by different amounts, so a content mix that outruns the surface
 * mix closes that gap. The first dark Vivid values (content 9%, surface 5%)
 * measured 1.000-1.020 in all nine presets and inverted the red channel in
 * ember and sunset: cards dissolved into the page.
 *
 * Floor: the separation the seeds have at subtle, minus 0.02. The tolerance
 * is what Tinted already spends (forest: 1.072 -> 1.058) plus one 8-bit
 * rounding step of a near-black mix (about 0.005); the absolute 1.05 in dark
 * is the lowest subtle value (1.068) less the same tolerance, rounded down.
 * Light seeds are identical (white on white, told apart by the hairline), so
 * there the floor is trivially met and only the direction is pinned.
 */
describe.each([
  ...LIGHT_SELECTORS.map((s) => [s, "light"] as const),
  ...DARK_SELECTORS.map((s) => [s, "dark"] as const),
])("raised surfaces stay off the content card — %s", (selector, mode) => {
  describe.each(["--surface", "--card"] as const)("%s", (seed) => {
    it.each(REACH_LEVELS)(
      "keeps its subtle separation (−0.02) and never inverts at reach %s",
      (level) => {
        const atSubtle = contrast(
          raised(selector, seed, "subtle"),
          contentCard(selector, "subtle"),
        );
        const surface = raised(selector, seed, level);
        const card = contentCard(selector, level);

        expect(contrast(surface, card)).toBeGreaterThanOrEqual(atSubtle - 0.02);
        if (mode === "dark") {
          expect(contrast(surface, card)).toBeGreaterThanOrEqual(1.05);
          expect(luminance(surface)).toBeGreaterThan(luminance(card));
        }
        // No channel may cross: a raised surface is lighter than the card in
        // dark and never lighter than it in light.
        surface.forEach((channel, i) => {
          if (mode === "dark") {
            expect(channel, `channel ${i}`).toBeGreaterThanOrEqual(card[i]);
          } else {
            expect(channel, `channel ${i}`).toBeLessThanOrEqual(card[i]);
          }
        });
      },
    );
  });
});

/** `--state-selected` is the brand at N% alpha, declared per MODE. */
function stateSelectedAlpha(mode: Mode): number {
  const raw = declaration(
    mode === "light" ? ":root" : ".dark",
    "--state-selected",
  );
  const m = raw.match(
    /^color-mix\(in oklab, var\(--brand\) (\d+(?:\.\d+)?)%, transparent\)$/,
  );
  if (!m) throw new Error(`--state-selected is not brand N% alpha: ${raw}`);
  return Number(m[1]) / 100;
}

/**
 * A selected row on `bg` at a reach level. The alias is
 * `color-mix(in srgb, var(--state-selected), var(--brand) var(--reach-selected))`:
 * both sides are the brand, so only the alpha interpolates — the fill is the
 * brand at `p + (1 − p) × seed alpha`.
 */
function selectedOn(
  selector: string,
  mode: Mode,
  level: ReachLevel,
  bg: RGB,
): RGB {
  const p = reachPct(level, "--reach-selected", mode) / 100;
  return over(
    hex(declaration(selector, "--brand")),
    p + (1 - p) * stateSelectedAlpha(mode),
    bg,
  );
}

/** Every ground a selected or hovered row is painted on, at a reach level. */
function rowGrounds(
  selector: string,
  mode: Mode,
  level: ReachLevel,
): Array<[string, RGB]> {
  const grounds: Array<[string, RGB]> = [
    ["content card", contentCard(selector, level)],
    ...RAISED_SURFACE_SEEDS.map(
      (seed) => [seed, raised(selector, seed, level)] as [string, RGB],
    ),
  ];
  if (mode === "dark") {
    // The sidebar: rows sit straight on the wash, and under the mesh bloom at
    // its declared peaks. Dark only — a row on the LIGHT wash is inside
    // `.chrome-scope`, where the hover and selected fills and the text are
    // different tokens altogether; "bold frame chrome text" below covers it.
    for (const stop of washStops(selector)) {
      grounds.push([`wash ${stop}`, hex(stop)]);
      for (const [where, ground] of darkBloomed(selector, stop)) {
        grounds.push([`bloomed wash ${stop} (${where})`, ground]);
      }
    }
  }
  return grounds;
}

/**
 * Selected vs hover. Selected is the brand at 14% alpha; once reach leaned the
 * hover fill to the brand too (12.6% alpha at tinted), an active sidebar row
 * and a hovered one composited to the same colour — hover was even the
 * stronger of the two on the dark wash (0.82x). `--reach-selected` adds brand
 * to the selected fill so it keeps its lead.
 *
 * Metric: the luminance lift of the composited fill over its own ground,
 * `contrast(fill on bg, bg) − 1`. Selected must lift at least 1.5x what hover
 * does, on every ground a row can sit on. 1.5 is not a taste number: it is
 * the worst ratio the pre-reach look has (subtle: 1.51, dark keystone under
 * the bloom), so the rule reads "no reach level is worse than subtle".
 */
describe.each([
  ...LIGHT_SELECTORS.map((s) => [s, "light"] as const),
  ...DARK_SELECTORS.map((s) => [s, "dark"] as const),
])("selected is visibly stronger than hover — %s", (selector, mode) => {
  const lift = (fill: RGB, bg: RGB) => contrast(fill, bg) - 1;

  describe.each(REACH_LEVELS)("at reach %s", (level) => {
    it("selected lifts ≥ 1.5× the hover fill on every ground", () => {
      for (const [name, bg] of rowGrounds(selector, mode, level)) {
        const selected = lift(selectedOn(selector, mode, level, bg), bg);
        const hover = lift(hovered(selector, mode, level, bg), bg);
        expect(selected / hover, name).toBeGreaterThanOrEqual(1.5);
      }
    });

    it("body text clears AA on a selected row and on a hovered row", () => {
      // Active rows, open menu triggers and the picked option all set
      // `text-foreground` on the fill.
      const fg = hex(declaration(selector, "--foreground"));
      for (const [name, bg] of rowGrounds(selector, mode, level)) {
        expect(
          contrast(fg, selectedOn(selector, mode, level, bg)),
          `selected on ${name}`,
        ).toBeGreaterThanOrEqual(AA);
        expect(
          contrast(fg, hovered(selector, mode, level, bg)),
          `hover on ${name}`,
        ).toBeGreaterThanOrEqual(AA);
      }
    });
  });
});

// The light palette's --muted-foreground is no longer painted on the wash (the
// bold frame's muted text is white — "bold frame chrome text" below), so what
// is left of this light check is the card and the raised surface.
describe.each(LIGHT_SELECTORS)(
  "muted text clears WCAG AA off the wash — light %s",
  (selector) => {
    const fg = hex(declaration(selector, "--muted-foreground"));

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
  const brand2 = hex(declaration(selector, "--brand-2"));

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
      // their geometry never produces. The first bloom is --brand, the second
      // --brand-2 (the same colour in a single-accent preset).
      const lit = glowPeaks().reduce<RGB>(
        (bg, peak, i) => over(i === 0 ? brand : brand2, peak, bg),
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

    it.each(washStops(selector))(
      "clears AA on the %s stop, unbloomed",
      (stop) => {
        expect(contrast(fg, hex(stop))).toBeGreaterThanOrEqual(AA);
      },
    );

    it.each(washStops(selector))(
      "clears AA on the %s stop under the bloom at its declared peak",
      (stop) => {
        for (const [where, ground] of darkBloomed(selector, stop)) {
          expect(contrast(fg, ground), where).toBeGreaterThanOrEqual(AA);
        }
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

describe.each(DARK_SELECTORS)(
  "kicker text clears WCAG AA on the wash — dark %s",
  (selector) => {
    const fg = hex(declaration(selector, "--kicker"));
    it.each(washStops(selector))(
      "clears AA on the %s stop under the bloom",
      (stop) => {
        for (const [where, ground] of darkBloomed(selector, stop)) {
          expect(contrast(fg, ground), where).toBeGreaterThanOrEqual(AA);
        }
      },
    );
  },
);

describe("the mesh bloom is derived per mode, never per preset", () => {
  it.each([...LIGHT_SELECTORS, ...DARK_SELECTORS].filter((s) => /\[/.test(s)))(
    "%s inherits --app-bloom",
    (selector) => {
      expect(declares(selector, "--app-bloom")).toBe(false);
    },
  );

  it("dark keeps the original first radial: 22% --brand, 110% 85% at 8% -6%, out at 58%", () => {
    expect(darkBloomRadials()[0]).toEqual({
      rx: 1.1,
      ry: 0.85,
      cx: 0.08,
      cy: -0.06,
      peak: 0.22,
      reach: 0.58,
    });
  });

  it("stacks radials that light the same pixel, and only those", () => {
    const at = (cx: number, cy: number): BloomRadial => ({
      rx: 0.5,
      ry: 0.5,
      cx,
      cy,
      peak: 0.2,
      reach: 1,
    });
    // Two disjoint discs → two grounds; a third bridging both → two stacks.
    expect(overlappingBloomRadials([at(0, 0), at(1, 1)])).toEqual([[0], [1]]);
    expect(overlappingBloomRadials([at(0, 0), at(1, 1), at(0.5, 0.5)])).toEqual(
      [
        [0, 2],
        [1, 2],
      ],
    );
    expect(overlappingBloomRadials([at(0.5, 0.5), at(0.5, 0.5)])).toEqual([
      [0, 1],
    ]);
  });

  it("light is three bright accent tints on the dark bloom's geometry", () => {
    const light = lightBloomRadials();
    const dark = darkBloomRadials();
    expect(light).toHaveLength(3);
    light.forEach((radial, n) => {
      const { rx, ry, cx, cy, reach } = dark[n];
      expect(radial).toMatchObject({ rx, ry, cx, cy, reach });
      // A tint, not the accent and not white; and a bloom, not a fill.
      expect(radial.tint).toBeGreaterThan(0);
      expect(radial.tint).toBeLessThan(100);
      expect(radial.peak).toBeGreaterThan(0);
      expect(radial.peak).toBeLessThan(0.5);
    });
    // One tint for the whole mesh.
    expect(new Set(light.map((r) => r.tint)).size).toBe(1);
  });
});

describe("--brand-gradient middle stop", () => {
  it("is derived in :root as the even sRGB mix of the two accents", () => {
    expect(declaration(":root", "--brand-mid")).toBe(BRAND_MID_RECIPE);
  });

  it.each([...LIGHT_SELECTORS, ...DARK_SELECTORS])(
    "the derived middle of %s is the sRGB midpoint, so the gradient is unchanged",
    (selector) => {
      if (declares(selector, "--brand-mid")) return; // Prism sets its own
      const a = hex(declaration(selector, "--brand"));
      const b = hex(declaration(selector, "--brand-2"));
      const mid = bloomColours(selector)[2];
      mid.forEach((c, i) =>
        expect(Math.abs(c - (a[i] + b[i]) / 2)).toBeLessThanOrEqual(0.5),
      );
    },
  );
});

describe.each(LIGHT_SELECTORS)(
  "light chrome separates from the content card — %s",
  (selector) => {
    // The frame and the card must read as two things. With the bold frame the
    // wash is far darker than the white card, so the binding case is the
    // LIGHTEST the chrome gets: a wash stop under the bloom at its declared
    // peak (the bloom is a bright tint, so it lifts the frame towards the
    // card). Every stop is checked on every bloomed ground and bare, although
    // only the header band — top-left, the first stop under the first radial
    // — actually runs along the card's edge.
    // Reach tints the card with the brand, which in light mode DARKENS it
    // towards the chrome, so each level is checked.
    it.each(REACH_LEVELS)(
      "every wash ground, bloomed or bare, vs the content card ≥ 1.15:1 at reach %s",
      (level) => {
        const card = contentCard(selector, level);
        for (const stop of washStops(selector)) {
          for (const [where, ground] of chromeGrounds(selector, stop)) {
            expect(
              contrast(ground, card),
              `${stop} ${where}`,
            ).toBeGreaterThanOrEqual(1.15);
            // …and it is the FRAME that is the dark one.
            expect(luminance(ground), `${stop} ${where}`).toBeLessThan(
              luminance(card),
            );
          }
        }
      },
    );
  },
);

/**
 * The bold frame (light mode). The light wash is a saturated gradient and the
 * chrome painted on it — sidebar, shell header, board dock, the /ask rail — is
 * white-on-colour: `:root:not(.dark) .chrome-scope` re-seeds the generic
 * tokens for that subtree, and `.chrome-reset` hands the root values back to
 * an opaque surface nested in it.
 *
 * So the text on a light wash stop is not the palette block's own grey: it is
 * the scope's white, and these are the checks that replace "muted / kicker
 * text clears AA on the wash — light". They run on every ground a stop can
 * become (`chromeGrounds`): bare, and once per set of bloom radials that can
 * light the same pixel, each at its declared peak. The bloom is a bright tint
 * here, so it works AGAINST white text.
 *
 * The scope's values are declared once, for every preset; only the wash, the
 * accents (bloom colours) and --brand (the primary label) come from the block
 * under test.
 */
const CHROME_SCOPE = ":root:not(.dark) .chrome-scope";
const CHROME_RESET = `${CHROME_SCOPE} .chrome-reset`;

/** A scope token that is `rgb(255 255 255 / N%)` → N/100. */
function chromeWhiteAlpha(token: string): number {
  const raw = declaration(CHROME_SCOPE, token);
  const m = raw.match(/^rgb\(255 255 255 \/ (\d+(?:\.\d+)?)%\)$/);
  if (!m)
    throw new Error(`${token} in the chrome scope is not white N%: ${raw}`);
  return Number(m[1]) / 100;
}

/** Every ground a light wash stop can become: bare, then under the bloom. */
function chromeGrounds(selector: string, stop: string): Array<[string, RGB]> {
  if (modeOf(selector) !== "light") throw new Error(`${selector} is not light`);
  return [["bare", hex(stop)], ...bloomed(selector, stop)];
}

describe.each(LIGHT_SELECTORS)("bold frame chrome text — %s", (selector) => {
  /** White at a scope token's alpha, composited on a ground. */
  const white = (token: string, ground: RGB) =>
    over(WHITE, chromeWhiteAlpha(token), ground);

  it("the scope's text, ring and brand are white", () => {
    for (const token of [
      "--foreground",
      "--ring",
      "--brand",
      "--brand-2",
      "--brand-mid",
      "--primary",
    ]) {
      expect(declaration(CHROME_SCOPE, token), token).toBe("#ffffff");
    }
  });

  it.each(washStops(selector))(
    "body, muted, kicker and error text clear AA on %s, bare and under the bloom",
    (stop) => {
      const destructive = hex(declaration(CHROME_SCOPE, "--destructive"));
      for (const [where, ground] of chromeGrounds(selector, stop)) {
        // White body text. The same number covers the white focus ring
        // (`ring-ring`) and the active indicator, which are non-text marks
        // with a 3:1 floor — AA is the stricter bound, so they have no case
        // of their own.
        expect(contrast(WHITE, ground), where).toBeGreaterThanOrEqual(AA);
        for (const token of ["--muted-foreground", "--kicker"]) {
          expect(
            contrast(white(token, ground), ground),
            `${token} ${where}`,
          ).toBeGreaterThanOrEqual(AA);
        }
        expect(
          contrast(destructive, ground),
          `--destructive ${where}`,
        ).toBeGreaterThanOrEqual(AA);
      }
    },
  );

  it.each(washStops(selector))(
    "selected out-lifts hover ≥ 1.5× on %s, and body text clears AA on both fills",
    (stop) => {
      // The same metric as "selected is visibly stronger than hover": the
      // lift of the composited fill over its own ground. Reach is switched
      // off inside the scope, so the fills are exactly the declared alphas.
      expect(declaration(CHROME_SCOPE, "--reach-hover")).toBe("0%");
      expect(declaration(CHROME_SCOPE, "--reach-selected")).toBe("0%");
      const lift = (fill: RGB, bg: RGB) => contrast(fill, bg) - 1;
      for (const [where, ground] of chromeGrounds(selector, stop)) {
        const hover = white("--state-hover", ground);
        const selected = white("--state-selected", ground);
        expect(
          lift(selected, ground) / lift(hover, ground),
          where,
        ).toBeGreaterThanOrEqual(1.5);
        // Active rows and hovered rows both set `text-foreground`.
        expect(
          contrast(WHITE, selected),
          `selected ${where}`,
        ).toBeGreaterThanOrEqual(AA);
        expect(contrast(WHITE, hover), `hover ${where}`).toBeGreaterThanOrEqual(
          AA,
        );
        // The chips and kbd: body text on the resting chrome fill.
        expect(
          contrast(WHITE, white("--chrome-fill", ground)),
          `chrome fill ${where}`,
        ).toBeGreaterThanOrEqual(AA);
      }
    },
  );

  it.each(washStops(selector))(
    "muted and kicker text clear AA on the resting chrome fill on %s",
    (stop) => {
      // The ⌘K kbd and the org kicker in the context-switcher chip: secondary
      // text ON `bg-chrome-fill`, not on the bare frame. Both the text and the
      // fill are white alphas, so the fill eats the text's headroom twice.
      // scripts/theme/gen-presets.mjs solves against the same case
      // (CHROME_FILL_ALPHA), so a wash can never be generated that fails it.
      for (const [where, ground] of chromeGrounds(selector, stop)) {
        const fill = white("--chrome-fill", ground);
        for (const token of ["--muted-foreground", "--kicker"]) {
          expect(
            contrast(white(token, fill), fill),
            `${token} on the chrome fill, ${where}`,
          ).toBeGreaterThanOrEqual(AA);
        }
      }
    },
  );

  it.each(washStops(selector))(
    "the lit seam is a ≥ 3:1 line on %s, with a haze of the same white",
    (stop) => {
      // The card seam (`.seam-line`) carries the scope: it strokes
      // --border-bright at rest and --foreground when lit, and blooms with
      // --seam-glow. The lit line is a non-text mark against the frame it
      // runs beside.
      const seam = CSS.slice(CSS.indexOf("\n  .seam-line {"));
      expect(seam.slice(0, seam.indexOf("\n  }"))).toMatch(
        /\n {4}stroke: var\(--border-bright\);/,
      );
      const lit = seam.slice(seam.indexOf(".seam-line {", 20));
      expect(lit.slice(0, lit.indexOf("\n  }"))).toMatch(
        /\n {4}stroke: var\(--foreground\);[\s\S]*filter: drop-shadow\(var\(--seam-glow\)\);/,
      );
      const line = hex(declaration(CHROME_SCOPE, "--foreground"));
      for (const [where, ground] of chromeGrounds(selector, stop)) {
        expect(contrast(line, ground), where).toBeGreaterThanOrEqual(3);
      }
      // The glow is re-derived inside the scope, from the scope's own
      // foreground: `:root` resolved it on <html>, where it is ink.
      expect(declaration(CHROME_SCOPE, "--seam-glow")).toBe(
        declaration(":root", "--seam-glow"),
      );
      expect(declaration(":root", "--seam-glow")).toBe(
        "0 0 7px color-mix(in oklab, var(--foreground) 45%, transparent)",
      );
    },
  );

  it.each(washStops(selector))(
    "every bloom radial at its peak is visible on %s (≥ 1.12:1 off the bare stop)",
    (stop) => {
      // The other side of the AA cap above: a bloom too faint to see is not a
      // mesh. Checked for every radial on every stop, like the text checks.
      for (const [where, ground] of bloomed(selector, stop)) {
        expect(contrast(ground, hex(stop)), where).toBeGreaterThanOrEqual(1.12);
        // A glow: it lightens the frame, never darkens it.
        expect(luminance(ground), where).toBeGreaterThan(luminance(hex(stop)));
      }
    },
  );

  it("the wash descends in lightness with visible range — no flat half", () => {
    // OKLCH lightness of the three stops: first ≥ 0.04 above the middle, the
    // middle ≥ 0.05 above the last.
    const stops = washStops(selector);
    expect(stops).toHaveLength(3);
    const [first, middle, last] = stops.map((stop) => oklch(hex(stop))[0]);
    expect(first - middle, "first → middle").toBeGreaterThanOrEqual(0.04);
    expect(middle - last, "middle → last").toBeGreaterThanOrEqual(0.05);
  });

  it("a primary button on the frame is white with the preset's brand as its label", () => {
    // Inside the scope the fill (--primary, --brand-gradient) is white and
    // the label reads the ROOT brand back through --base-brand.
    expect(declaration(CHROME_SCOPE, "--brand-gradient")).toBe(
      "linear-gradient(90deg, #ffffff, #ffffff)",
    );
    for (const token of ["--primary-foreground", "--brand-foreground"]) {
      expect(declaration(CHROME_SCOPE, token), token).toBe("var(--base-brand)");
    }
    expect(
      contrast(hex(declaration(selector, "--brand")), WHITE),
    ).toBeGreaterThanOrEqual(AA);
  });

  it.each(washStops(selector))(
    "a HOVERED primary button on the frame keeps an AA label on %s",
    (stop) => {
      // `hover:bg-brand-gradient-hover` paints --brand-gradient-hover. At the
      // root that is the brand stops at 80% alpha over nothing; left to
      // derive from the scope's white brand it was white at 80%, the frame
      // showed through and the brand label measured about 3.1:1. The scope
      // re-seeds the image instead. Every stop of it is composited on every
      // ground the button can sit on, under the label it carries there.
      const label = hex(declaration(selector, "--brand"));
      const stops = [
        ...declaration(CHROME_SCOPE, "--brand-gradient-hover").matchAll(
          /#ffffff|rgb\(255 255 255 \/ (\d+(?:\.\d+)?)%\)/g,
        ),
      ].map((m) => (m[1] === undefined ? 1 : Number(m[1]) / 100));
      expect(stops.length).toBeGreaterThanOrEqual(2);
      for (const [where, ground] of chromeGrounds(selector, stop)) {
        for (const alpha of stops) {
          expect(
            contrast(label, over(WHITE, alpha, ground)),
            `white ${alpha * 100}% ${where}`,
          ).toBeGreaterThanOrEqual(AA);
        }
      }
    },
  );

  it("every wash stop is darker than the brand, so the frame reads as a frame", () => {
    for (const stop of washStops(selector)) {
      expect(luminance(hex(stop)), stop).toBeLessThanOrEqual(
        luminance(hex(declaration(selector, "--brand"))) + 0.02,
      );
    }
  });
});

describe("chrome scope", () => {
  /** The custom properties a top-level block declares, in order. */
  const tokensOf = (selector: string) =>
    [...blockOf(selector).matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((m) => m[1]);

  it("is light-only: every rule that names the scope or the reset starts with :root:not(.dark)", () => {
    const [screen, print, ...more] = CSS.replace(/\/\*[\s\S]*?\*\//g, "").split(
      "@media print",
    );
    expect(more).toEqual([]);
    const rulesIn = (css: string) =>
      css
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /\.chrome-(scope|reset)/.test(line));
    // The two token blocks, and the two selectors of the base-layer `color`
    // rule.
    expect(rulesIn(screen).sort()).toEqual(
      [
        `${CHROME_SCOPE} {`,
        `${CHROME_RESET} {`,
        `${CHROME_SCOPE},`,
        `${CHROME_RESET} {`,
      ].sort(),
    );
    // …and exactly one more, in print: the scope handing its tokens back so
    // the chrome prints dark-on-paper (print-styles.test.ts pins its body).
    // It is light-only like the rest.
    expect(rulesIn(print)).toEqual([`${CHROME_SCOPE} {`]);
  });

  it("the reset restores every token the scope moves, in the same order", () => {
    const moved = tokensOf(CHROME_SCOPE);
    expect(moved.length).toBeGreaterThan(0);
    expect(tokensOf(CHROME_RESET)).toEqual(moved);
    for (const token of moved) {
      const base = `--base-${token.slice(2)}`;
      expect(declaration(CHROME_RESET, token), token).toBe(`var(${base})`);
      // …and the alias it reads is captured on <html>, from the same token.
      expect(declaration(":root", base), base).toBe(`var(${token})`);
    }
  });

  it("captures the base aliases once, in :root — never in .dark or a preset block", () => {
    const aliases = tokensOf(":root").filter((t) => t.startsWith("--base-"));
    expect(aliases.sort()).toEqual(
      tokensOf(CHROME_SCOPE)
        .map((t) => `--base-${t.slice(2)}`)
        .sort(),
    );
    for (const selector of [".dark", ...LIGHT_SELECTORS, ...DARK_SELECTORS]) {
      if (selector === ":root") continue;
      expect(blockOf(selector), selector).not.toMatch(/--base-/);
    }
  });

  it("flips the inherited text colour from the base layer, so a text utility still wins", () => {
    const base = CSS.slice(CSS.indexOf("\n@layer base {"));
    expect(base.slice(0, base.indexOf("\n}"))).toMatch(
      /\n {2}:root:not\(\.dark\) \.chrome-scope,\n {2}:root:not\(\.dark\) \.chrome-scope \.chrome-reset \{\n {4}color: var\(--foreground\);\n {2}\}/,
    );
    // Neither token block may set `color` itself: unlayered, it would beat
    // every text utility on the same element.
    for (const selector of [CHROME_SCOPE, CHROME_RESET]) {
      expect(blockOf(selector), selector).not.toMatch(/^\s*color:/m);
    }
  });
});

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

    // The gradient's far stop sits under the same label: a primary button, an
    // active pill or a filled bar can put --brand-foreground anywhere along
    // --brand-gradient. In an sRGB gradient every channel lies between the two
    // stops, but luminance is not monotonic in hue, so both ENDS are pinned
    // here and the midpoint just below.
    it("brand button label clears AA on the second accent (--brand-2)", () => {
      expect(
        contrast(
          hex(declaration(selector, "--brand-foreground")),
          hex(declaration(selector, "--brand-2")),
        ),
      ).toBeGreaterThanOrEqual(AA);
    });

    it("brand button label clears AA at the middle of --brand-gradient", () => {
      expect(
        contrast(
          hex(declaration(selector, "--brand-foreground")),
          // The block's own --brand-mid where it declares one (Prism bends
          // the gradient through a third hue); the even mix otherwise.
          bloomColours(selector)[2],
        ),
      ).toBeGreaterThanOrEqual(AA);
    });

    it("the middle stop under test is the block's own --brand-mid when it declares one", () => {
      const mid = bloomColours(selector)[2];
      const even = mixSrgb(
        hex(declaration(selector, "--brand")),
        hex(declaration(selector, "--brand-2")),
        50,
      );
      if (declares(selector, "--brand-mid") && selector !== ":root") {
        expect(mid).toEqual(hex(declaration(selector, "--brand-mid")));
        expect(mid).not.toEqual(even);
      } else {
        expect(mid).toEqual(even);
      }
    });

    // Progress fills and the sidebar indicator are non-text marks, and their
    // far end is --brand-2.
    it.each(REACH_LEVELS)(
      "the second accent is a visible non-text mark on the content card (≥3:1) at reach %s",
      (level) => {
        expect(
          contrast(
            hex(declaration(selector, "--brand-2")),
            contentCard(selector, level),
          ),
        ).toBeGreaterThanOrEqual(3);
      },
    );

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

/**
 * Chart colours (tinted and vivid; subtle keeps the pre-reach greys, pinned in
 * globals.tokens.test.ts). `--chart-1` and `--chart-cat-1` ARE --brand, whose
 * >= 3:1 floor on the content card at every reach level is "the brand is a
 * visible non-text mark" above. What is left to prove here is the rest of the
 * ramp and the second categorical series, which are read out of the stylesheet
 * and recomputed for every preset and mode.
 */
function chartColour(selector: string, token: string): RGB {
  // Chart tokens are derived once per MODE; the preset only moves the seeds.
  const raw = declaration(
    modeOf(selector) === "light" ? ":root" : ".dark",
    token,
  ).replace(/\s+/g, " ");
  if (raw === "var(--brand)") return hex(declaration(selector, "--brand"));
  const m = raw.match(
    /^color-mix\( ?in srgb, var\((--[a-z0-9-]+)\) (\d+)%, var\((--[a-z0-9-]+)\) ?\)$/,
  );
  if (!m)
    throw new Error(`${token} is not var(--brand) or an sRGB mix: ${raw}`);
  return mixSrgb(
    hex(declaration(selector, m[1])),
    hex(declaration(selector, m[3])),
    Number(m[2]),
  );
}

/** sRGB → OKLab, for a perceptual distance between two series colours. */
function oklab(rgb: RGB): [number, number, number] {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaE(a: RGB, b: RGB): number {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** sRGB → OKLCH: lightness, chroma, hue in degrees [0, 360). */
function oklch(rgb: RGB): [number, number, number] {
  const [l, a, b] = oklab(rgb);
  return [
    l,
    Math.hypot(a, b),
    ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
  ];
}

/** OKLCH → LINEAR sRGB, unclamped — a channel outside [0, 1] is out of gamut. */
function oklchToLinearSrgb([L, C, h]: [number, number, number]): number[] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inSrgbGamut(lch: [number, number, number]): boolean {
  return oklchToLinearSrgb(lch).every((v) => v >= 0 && v <= 1);
}

function oklchToSrgb(lch: [number, number, number]): RGB {
  return oklchToLinearSrgb(lch).map((v) => {
    const c = Math.min(1, Math.max(0, v));
    return Math.round(
      255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055),
    );
  }) as RGB;
}

describe("OKLCH helpers", () => {
  it("round-trips sRGB → OKLCH → sRGB exactly, in 8-bit", () => {
    for (const colour of [
      [127, 207, 156],
      [90, 110, 213],
      [201, 201, 210],
      [255, 255, 255],
      [14, 14, 16],
    ] as RGB[]) {
      expect(oklchToSrgb(oklch(colour))).toEqual(colour);
    }
  });

  it("matches the CSS Color 4 reference value for sRGB red", () => {
    // red is oklch(0.628 0.2577 29.23).
    const [l, c, h] = oklch([255, 0, 0]);
    expect(l).toBeCloseTo(0.628, 3);
    expect(c).toBeCloseTo(0.2577, 3);
    expect(h).toBeCloseTo(29.23, 1);
  });
});

/**
 * Categorical chart colours (tinted and vivid; subtle pins the old literals).
 *
 * `--chart-cat-1` is the brand. `--chart-cat-2..6` used to be a tint of the
 * brand plus four FIXED hues, which collided two ways: cat-2 was the same hue
 * as cat-1 in every single-accent preset, and a warm or green brand landed on
 * top of a fixed hue (dark sunset vs #f59e0b: ΔE 0.046; dark forest vs
 * #34d399: 0.052). They are now ROTATIONS of the brand's own hue —
 * `oklch(from var(--brand) L C calc(h + N))` at 60° steps — so the six sit a
 * sixth of the wheel apart whatever the brand is.
 *
 * Lightness and chroma are fixed numbers, chosen INSIDE the sRGB gamut at
 * every hue. That is what makes this file able to predict the browser: an
 * in-gamut oklch() needs no gamut mapping, which engines do differently.
 */
const ROTATED_SUPPORTS = "@supports (color: oklch(from red l c h)) {";

function rotatedBlock(mode: Mode): string {
  const start = CSS.indexOf(`\n${ROTATED_SUPPORTS}`);
  if (start === -1) throw new Error("no relative-colour @supports block");
  const body = CSS.slice(start, CSS.indexOf("\n}", start + 1));
  const open = body.indexOf(mode === "light" ? "\n  :root {" : "\n  .dark {");
  if (open === -1) throw new Error(`no ${mode} block inside @supports`);
  return body.slice(open, body.indexOf("\n  }", open));
}

type Rotation = { l: number; c: number; turn: number };

function rotation(mode: Mode, n: number): Rotation {
  const m = rotatedBlock(mode).match(
    new RegExp(
      `--chart-cat-${n}:\\s*oklch\\(\\s*from var\\(--brand\\)\\s+([\\d.]+)\\s+([\\d.]+)\\s+calc\\(h \\+ (\\d+)\\)\\s*\\);`,
    ),
  );
  if (!m) {
    throw new Error(
      `--chart-cat-${n} (${mode}) is not oklch(from var(--brand) L C calc(h + N))`,
    );
  }
  return { l: Number(m[1]), c: Number(m[2]), turn: Number(m[3]) };
}

const ROTATED = [2, 3, 4, 5, 6] as const;

/** The six categorical colours as an engine with relative colour paints them. */
function categorical(selector: string): RGB[] {
  const brand = hex(declaration(selector, "--brand"));
  const hue = oklch(brand)[2];
  return [
    brand,
    ...ROTATED.map((n) => {
      const { l, c, turn } = rotation(modeOf(selector), n);
      return oklchToSrgb([l, c, (hue + turn) % 360]);
    }),
  ];
}

describe.each(["light", "dark"] as const)(
  "categorical chart colours — the %s rotation",
  (mode) => {
    it("redeclares exactly --chart-cat-2..6, at five 60° steps from the brand", () => {
      expect(
        [...rotatedBlock(mode).matchAll(/^\s{4}(--[a-z0-9-]+):/gm)].map(
          (m) => m[1],
        ),
      ).toEqual(ROTATED.map((n) => `--chart-cat-${n}`));
      expect(ROTATED.map((n) => rotation(mode, n).turn)).toEqual([
        60, 120, 180, 240, 300,
      ]);
    });

    it("every rotated colour is inside sRGB at EVERY hue — no gamut mapping, for any brand", () => {
      for (const n of ROTATED) {
        const { l, c } = rotation(mode, n);
        for (let h = 0; h < 360; h++) {
          expect(inSrgbGamut([l, c, h]), `--chart-cat-${n} at hue ${h}`).toBe(
            true,
          );
        }
      }
    });

    it("neighbouring rotations are ≥ 0.10 apart by construction, whatever the brand", () => {
      // Two colours 60° apart at chroma c1, c2 and lightness l1, l2 are
      // sqrt(Δl² + c1² + c2² − c1·c2) apart in OKLab — independent of hue.
      for (let i = 1; i < ROTATED.length; i++) {
        const a = rotation(mode, ROTATED[i - 1]);
        const b = rotation(mode, ROTATED[i]);
        expect(
          Math.sqrt((a.l - b.l) ** 2 + a.c ** 2 + b.c ** 2 - a.c * b.c),
        ).toBeGreaterThanOrEqual(0.1);
      }
    });
  },
);

describe.each([...LIGHT_SELECTORS, ...DARK_SELECTORS])(
  "categorical chart colours — %s",
  (selector) => {
    it("all six are told apart pairwise (OKLab ΔE ≥ 0.10)", () => {
      // WCAG contrast is luminance-only and blind to hue, so this is an OKLab
      // distance. 0.02 is roughly one just-noticeable difference; 0.10 is five
      // of them, and twice what the old palette's worst pairs had (0.046-0.072
      // in five dark presets). It is also what the geometry can promise: the
      // largest chroma that stays inside sRGB at every hue is about 0.12, and
      // 60° of hue at that chroma is 0.12 apart before any lightness step.
      const colours = categorical(selector);
      for (let i = 0; i < colours.length; i++) {
        for (let j = i + 1; j < colours.length; j++) {
          expect(
            deltaE(colours[i], colours[j]),
            `--chart-cat-${i + 1} vs --chart-cat-${j + 1}`,
          ).toBeGreaterThanOrEqual(0.1);
        }
      }
    });

    // Subtle is not listed: there the six are the pre-reach literals.
    it.each(["tinted", "vivid"] as const)(
      "each is a visible non-text mark (≥ 3:1) on the content card and on --card at reach %s",
      (level) => {
        categorical(selector).forEach((colour, i) => {
          for (const ground of [
            contentCard(selector, level),
            raised(selector, "--card", level),
          ]) {
            expect(
              contrast(colour, ground),
              `--chart-cat-${i + 1}`,
            ).toBeGreaterThanOrEqual(3);
          }
        });
      },
    );
  },
);

describe.each([...LIGHT_SELECTORS, ...DARK_SELECTORS])(
  "chart colours — %s",
  (selector) => {
    const ramp = () =>
      [1, 2, 3, 4, 5].map((n) => chartColour(selector, `--chart-${n}`));

    it("the series ramp and the first categorical colour start at --brand", () => {
      const brand = hex(declaration(selector, "--brand"));
      expect(chartColour(selector, "--chart-1")).toEqual(brand);
      expect(chartColour(selector, "--chart-cat-1")).toEqual(brand);
    });

    it("adjacent ramp steps stay distinguishable (≥ 1.15:1)", () => {
      const steps = ramp();
      for (let i = 1; i < steps.length; i++) {
        expect(
          contrast(steps[i - 1], steps[i]),
          `--chart-${i} vs --chart-${i + 1}`,
        ).toBeGreaterThanOrEqual(1.15);
      }
    });

    it.each(REACH_LEVELS)(
      "the ramp fades monotonically into the content card at reach %s, and its last step is still off it",
      (level) => {
        const card = contentCard(selector, level);
        const vsCard = ramp().map((c) => contrast(c, card));
        for (let i = 1; i < vsCard.length; i++) {
          expect(vsCard[i], `--chart-${i + 1}`).toBeLessThan(vsCard[i - 1]);
        }
        expect(vsCard[4]).toBeGreaterThanOrEqual(1.15);
      },
    );

    // The base-block --chart-cat-2 is now only the FALLBACK for engines
    // without relative colour syntax; the six-way distinctness guarantee is
    // "categorical chart colours" below.
    it.each(REACH_LEVELS)(
      "the fallback second categorical series is a visible mark on the content card (≥ 3:1) at reach %s",
      (level) => {
        expect(
          contrast(
            chartColour(selector, "--chart-cat-2"),
            contentCard(selector, level),
          ),
        ).toBeGreaterThanOrEqual(3);
      },
    );
  },
);
