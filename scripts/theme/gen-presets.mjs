// Generates theme preset values from OKLCH hue pairs. Output is pasted into
// src/app/globals.css and src/lib/theme/presets.ts; globals.contrast.test.ts
// is the judge of every value, not this script.
//
//   node scripts/theme/gen-presets.mjs wash <h1> <h2> [chroma scale]
import { pathToFileURL } from "node:url";

const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGam = (v) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;

/** OKLCH → linear sRGB (unclamped). */
function oklchToLinear(L, C, h) {
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
const inGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** OKLCH → #rrggbb, lowering chroma until the colour is inside sRGB. */
export function oklchToHex(L, C, h) {
  let c = C;
  let rgb = oklchToLinear(L, c, h);
  while (!inGamut(rgb) && c > 0) {
    c -= 0.002;
    rgb = oklchToLinear(L, Math.max(c, 0), h);
  }
  return (
    "#" +
    rgb
      .map((v) =>
        Math.round(
          Math.min(1, Math.max(0, toGam(Math.min(1, Math.max(0, v))))) * 255,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex) => {
  const [r, g, b] = rgbOf(hex).map((v) => toLin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrastHex(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const overHex = (fg, alpha, bg) =>
  "#" +
  rgbOf(fg)
    .map((c, i) =>
      Math.round(alpha * c + (1 - alpha) * rgbOf(bg)[i])
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

/** Must equal the values in globals.css — `--muted-foreground`,
 *  `--state-selected` and `--destructive` in `:root:not(.dark) .chrome-scope`,
 *  and the light `--app-bloom` in `:root`. scripts/theme/gen-presets.test.mjs
 *  reads the stylesheet and fails when either side moves alone. */
export const CHROME_MUTED_ALPHA = 0.9;
export const CHROME_SELECTED_ALPHA = 0.16;
export const CHROME_DESTRUCTIVE = "#ffd5cf";
export const LIGHT_BLOOM = {
  /** Share of the accent in each radial's colour; the rest is white. */
  tint: 0.7,
  /** Declared alpha at each radial's centre. */
  peaks: [0.18, 0.16, 0.16],
  /** `radial-gradient(RX RY at CX CY, … 0%, transparent REACH)`, as fractions
   *  of the `.app-wash` box, in declaration order. */
  radials: [
    { rx: 1.1, ry: 0.85, cx: 0.08, cy: -0.06, reach: 0.58 },
    { rx: 0.9, ry: 0.6, cx: 1, cy: 1, reach: 0.6 },
    { rx: 0.7, ry: 0.4, cx: 0, cy: 0.8, reach: 0.6 },
  ],
};

/** The solver's target: AA is 4.5, and the 0.1 absorbs 8-bit rounding. */
export const TARGET = 4.6;
/** Shape: the stops descend in OKLCH lightness by at least these steps
 *  (first → middle, middle → last), so no wash has a flat half. Bound by
 *  globals.contrast.test.ts. */
export const MIN_STEPS = [0.04, 0.05];
/** How far the solver lowers a stop's lightness per try. */
const STEP = 0.005;

/**
 * Which radials can light the SAME pixel: every maximal set of radial indices
 * whose lit ellipses intersect inside the box. The same 0.5% grid sample as
 * `overlappingBloomRadials` in globals.contrast.test.ts, so the solver and the
 * test stack the bloom identically.
 */
export function overlappingRadials(radials) {
  const STEPS = 200;
  const masks = new Set();
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

/** `color-mix(in srgb, a share, b)` for two opaque colours. */
const mixHex = (a, b, share) => overHex(a, share, b);

/**
 * The three colours the light bloom is painted with for a preset, in the
 * radials' order: --brand, --brand-2, --brand-mid, each tinted towards white
 * by `LIGHT_BLOOM.tint`. `accents` is `[brand, brand2, brandMid?]`; the middle
 * defaults to the even sRGB mix, which is what `:root` derives. With no
 * accents the bloom is taken as pure white — the most pessimistic colour
 * there is, for a caller that does not know the preset yet.
 */
export function bloomColours(accents) {
  if (!accents) return ["#ffffff", "#ffffff", "#ffffff"];
  const [brand, brand2, mid = mixHex(brand, brand2, 0.5)] = accents;
  return [brand, brand2, mid].map((c) =>
    mixHex(c, "#ffffff", LIGHT_BLOOM.tint),
  );
}

let bloomGroups;

/**
 * Every ground a wash stop can become: bare, and once per set of radials that
 * can light the same pixel, each radial of the set stacked at its declared
 * peak in its own colour — exactly the grounds globals.contrast.test.ts
 * builds.
 */
export function groundsOf(stop, accents) {
  bloomGroups ??= overlappingRadials(LIGHT_BLOOM.radials);
  const colours = bloomColours(accents);
  return [
    stop,
    ...bloomGroups.map((group) =>
      group.reduce(
        (bg, n) => overHex(colours[n], LIGHT_BLOOM.peaks[n], bg),
        stop,
      ),
    ),
  ];
}

/**
 * The tightest chrome text contrast on a wash stop, over every ground it can
 * become. Three checks can bind, and each is one the test asserts: white
 * muted text on the ground, the scope's pale error red on the ground, and
 * white body text on a selected row (the strongest fill a row takes).
 */
export function worstChromeContrast(stop, accents) {
  return Math.min(
    ...groundsOf(stop, accents).flatMap((ground) => [
      contrastHex(overHex("#ffffff", CHROME_MUTED_ALPHA, ground), ground),
      contrastHex(CHROME_DESTRUCTIVE, ground),
      contrastHex("#ffffff", overHex("#ffffff", CHROME_SELECTED_ALPHA, ground)),
    ]),
  );
}

/**
 * A wash stop's hue. A dark amber is brown, so a WASH stop (never the brand)
 * whose hue falls in 50–95 is pulled to 45, burnt orange. Lime and olive
 * (95–135) are left alone.
 */
export function washHue(h) {
  const hue = ((h % 360) + 360) % 360;
  return hue >= 50 && hue <= 95 ? 45 : hue;
}

/**
 * Three wash stops, hue1 → hue2: a saturated mid-tone frame, each stop as
 * light as it can be while white chrome text still clears TARGET on it under
 * the preset's own bloom, then stepped so the three descend in lightness.
 * `accents` is `[brand, brand2, brandMid?]` (see `bloomColours`). Returns the
 * stops with the lightness each one was solved at.
 */
export function solveBoldWashDetailed(h1, h2, cs = 1, accents) {
  const targets = [
    [0.52, 0.16, h1],
    [0.44, 0.16, h1 + (((h2 - h1 + 540) % 360) - 180) * 0.6],
    [0.33, 0.12, h2],
  ];
  const at = (L, C, h) => oklchToHex(L, C * cs, washHue(h));
  const solved = [];
  targets.forEach(([L0, C, h], i) => {
    // The shape rule lowers a later stop; it never raises an earlier one.
    // (Half a step more than the floor, so 8-bit rounding of the hex cannot
    // eat into it.)
    let L =
      i === 0
        ? L0
        : Math.min(L0, solved[i - 1].L - MIN_STEPS[i - 1] - STEP / 2);
    let stop = at(L, C, h);
    while (worstChromeContrast(stop, accents) < TARGET && L > 0.15) {
      L -= STEP;
      stop = at(L, C, h);
    }
    solved.push({ stop, L: Math.round(L * 1000) / 1000 });
  });
  return solved;
}

/** `solveBoldWashDetailed`, as the three hex stops. */
export function solveBoldWash(h1, h2, cs = 1, accents) {
  return solveBoldWashDetailed(h1, h2, cs, accents).map((s) => s.stop);
}

/**
 * The light wash recipe of the five presets that predate this script: the
 * arguments of `solveBoldWash` — two hues, a chroma scale, and the preset's
 * LIGHT accents (--brand, --brand-2), which colour its bloom. Their
 * `--app-wash` values in globals.css are this function's output, pasted;
 * gen-presets.test.mjs fails when the two drift, and when an accent here
 * stops matching the stylesheet.
 */
export const BASE_WASHES = {
  keystone: { hues: [272, 272], cs: 1, accents: ["#5a6ed5", "#5a6ed5"] },
  graphite: { hues: [280, 280], cs: 0.07, accents: ["#4b4b55", "#4b4b55"] },
  aurora: { hues: [180, 290], cs: 1, accents: ["#0f7d71", "#6b59d3"] },
  sunset: { hues: [62, 355], cs: 1, accents: ["#b65318", "#c0386f"] },
  nebula: { hues: [300, 255], cs: 1, accents: ["#7450d6", "#2f6cc0"] },
};

/** The `--app-wash` declaration for a solved wash. */
export function washDeclaration([a, b, c]) {
  return `--app-wash: linear-gradient(168deg, ${a} 0%, ${b} 46%, ${c} 100%);`;
}

// CLI — only when run directly, never when a test imports the module.
//   wash <h1> <h2> [cs] [brand] [brand2] [brandMid]   one wash
//   base                                              the five shipped washes
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "wash" && args.length >= 2) {
    const [h1, h2, cs] = args.slice(0, 3).map(Number);
    const accents = args.slice(3);
    console.log(
      washDeclaration(
        solveBoldWash(
          h1,
          h2,
          cs || 1,
          accents.length >= 2 ? accents : undefined,
        ),
      ),
    );
  } else if (command === "base") {
    for (const [id, { hues, cs, accents }] of Object.entries(BASE_WASHES)) {
      const solved = solveBoldWashDetailed(...hues, cs, accents);
      console.log(
        `${id.padEnd(9)} ${washDeclaration(solved.map((s) => s.stop))}  L ${solved.map((s) => s.L).join(" / ")}`,
      );
    }
  } else {
    console.error(
      "usage: node scripts/theme/gen-presets.mjs wash <h1> <h2> [cs] [brand brand2 [brandMid]] | base",
    );
    process.exitCode = 1;
  }
}
