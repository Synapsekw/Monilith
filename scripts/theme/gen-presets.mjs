// Generates theme preset values from OKLCH hue pairs. Output is pasted into
// src/app/globals.css and src/lib/theme/presets.ts; globals.contrast.test.ts
// is the judge of every value, not this script.
//
//   node scripts/theme/gen-presets.mjs wash <h1> <h2> [chroma scale]
//   node scripts/theme/gen-presets.mjs presets
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
/** Visibility: every bloom radial at its peak lifts a stop by at least this
 *  contrast ratio. globals.contrast.test.ts asserts 1.12; the 0.005 absorbs
 *  8-bit rounding. A glow in a hue far from the stop's (a teal bloom on a
 *  pink stop) barely moves its luminance, so the stop has to sit darker. */
export const BLOOM_VISIBLE = 1.125;
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
 * The faintest bloom radial on a wash stop: the smallest contrast ratio
 * between the bare stop and any ground the bloom turns it into.
 */
export function faintestBloom(stop, accents) {
  return Math.min(
    ...groundsOf(stop, accents)
      .slice(1)
      .map((ground) => contrastHex(ground, stop)),
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
 * the preset's own bloom and every bloom radial stays visible on it
 * (BLOOM_VISIBLE), then stepped so the three descend in lightness.
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
    while (
      (worstChromeContrast(stop, accents) < TARGET ||
        faintestBloom(stop, accents) < BLOOM_VISIBLE) &&
      L > 0.15
    ) {
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

/**
 * The twelve generated two-accent presets, in registry order (after Nebula).
 * `h1`/`h2` are the OKLCH hues of --brand / --brand-2; `mid` is the hue of an
 * own --brand-mid (Prism only); `cs` scales every chroma in the recipe. Their
 * blocks in globals.css and entries in presets.ts are `presets` output,
 * pasted; gen-presets.test.mjs fails when either drifts from this table.
 */
export const NEW_PRESETS = [
  {
    id: "lagoon",
    label: "Lagoon",
    h1: 200,
    h2: 258,
    note: "cyan into blue over a deep-water wash",
  },
  {
    id: "tropic",
    label: "Tropic",
    h1: 172,
    h2: 128,
    note: "teal into lime over a palm-green wash",
  },
  {
    id: "orchid",
    label: "Orchid",
    h1: 335,
    h2: 292,
    note: "magenta into violet over a plum wash",
  },
  {
    id: "peach",
    label: "Peach",
    h1: 32,
    h2: 82,
    note: "coral into gold over a warm clay wash",
  },
  {
    id: "glacier",
    label: "Glacier",
    h1: 228,
    h2: 188,
    cs: 0.6,
    note: "ice blue into mint, low chroma",
  },
  {
    id: "dusk",
    label: "Dusk",
    h1: 275,
    h2: 8,
    note: "indigo into rose over a twilight wash",
  },
  {
    id: "berry",
    label: "Berry",
    h1: 15,
    h2: 318,
    note: "crimson into purple over a wine wash",
  },
  {
    id: "candy",
    label: "Candy",
    h1: 350,
    h2: 215,
    cs: 0.75,
    note: "pastel pink into cyan",
  },
  {
    id: "citrus",
    label: "Citrus",
    h1: 118,
    h2: 68,
    note: "lime into orange over an olive wash",
  },
  {
    id: "prism",
    label: "Prism",
    h1: 208,
    h2: 350,
    mid: 292,
    note: "cyan through violet into pink, the one three-stop preset",
  },
  {
    id: "mocha",
    label: "Mocha",
    h1: 58,
    h2: 28,
    cs: 0.55,
    note: "caramel into terracotta, earthy and low chroma",
  },
  {
    id: "neon",
    label: "Neon",
    h1: 152,
    h2: 312,
    cs: 1.15,
    note: "green into fuchsia, high chroma",
  },
];

/** The label a brand fill carries, per mode (--brand-foreground). */
const LABEL = { light: "#ffffff", dark: "#0e0e10" };

/**
 * The value recipe: `[lightness, chroma]` per token, taken from the shipped
 * Nebula block. Brand chroma is scaled by the preset's `cs`; the neutrals'
 * tint is scaled by `max(cs, NEUTRAL_CS_FLOOR)`, so a low-chroma preset still
 * tints its greys. globals.contrast.test.ts judges the result — a failure is
 * fixed here or in a preset's row, then regenerated.
 */
export const RECIPE = {
  light: {
    brand: [0.52, 0.16],
    brand2: [0.52, 0.17],
    mid: [0.52, 0.17],
    background: [0.972, 0.005],
    foreground: [0.21, 0.015],
    muted: [0.952, 0.009],
    mutedFg: [0.45, 0.025],
  },
  dark: {
    brand: [0.8, 0.125],
    brand2: [0.77, 0.135],
    mid: [0.78, 0.13],
    background: [0.165, 0.006],
    foreground: [0.965, 0.005],
    surface: [0.205, 0.006],
    muted: [0.232, 0.007],
    secondary: [0.272, 0.008],
    mutedFg: [0.8, 0.022],
    wash: [
      [0.27, 0.06],
      [0.2, 0.05],
      [0.12, 0.012],
    ],
  },
};
const NEUTRAL_CS_FLOOR = 0.5;

/**
 * A brand fill: the recipe's colour, moved away from its label (darker under
 * a white label, lighter under a dark one) until the label clears TARGET.
 */
function brandFor([L0, C], cs, h, mode) {
  const dir = mode === "light" ? -1 : 1;
  let L = L0;
  let hex = oklchToHex(L, C * cs, h);
  while (contrastHex(hex, LABEL[mode]) < TARGET && L > 0.3 && L < 0.95) {
    L += dir * STEP;
    hex = oklchToHex(L, C * cs, h);
  }
  return hex;
}

/** Every generated value of one preset, per mode. */
export function presetValues(p) {
  const cs = p.cs ?? 1;
  const { light: rl, dark: rd } = RECIPE;
  const neutral = ([L, C]) =>
    oklchToHex(L, C * Math.max(cs, NEUTRAL_CS_FLOOR), p.h1);
  const accents = (r, mode) => ({
    brand: brandFor(r.brand, cs, p.h1, mode),
    brand2: brandFor(r.brand2, cs, p.h2, mode),
    mid: p.mid != null ? brandFor(r.mid, cs, p.mid, mode) : null,
  });
  const light = {
    ...accents(rl, "light"),
    background: neutral(rl.background),
    foreground: neutral(rl.foreground),
    muted: neutral(rl.muted),
    mutedFg: neutral(rl.mutedFg),
  };
  // The bold frame, solved under this preset's own light bloom.
  light.wash = solveBoldWash(
    p.h1,
    p.h2,
    cs,
    [light.brand, light.brand2, light.mid].filter(Boolean),
  );
  const dark = {
    ...accents(rd, "dark"),
    background: neutral(rd.background),
    foreground: neutral(rd.foreground),
    surface: neutral(rd.surface),
    muted: neutral(rd.muted),
    secondary: neutral(rd.secondary),
    mutedFg: neutral(rd.mutedFg),
    wash: rd.wash.map(([L, C], i) =>
      oklchToHex(L, C * cs, i === 0 ? p.h1 : p.h2),
    ),
  };
  return { light, dark };
}

/** The two override blocks of one preset, exactly as prettier leaves them. */
export function cssBlocks(p) {
  const { light: l, dark: d } = presetValues(p);
  const mid = (v) => (v ? `  --brand-mid: ${v};\n` : "");
  return `/* ${p.label} — ${p.note}.
   Generated by scripts/theme/gen-presets.mjs (\`presets\`) — never edit by
   hand. Only the tokens a preset can move are declared; everything
   alpha-based or brand-derived follows. */
:root[data-theme-preset="${p.id}"] {
  --brand: ${l.brand};
  --brand-2: ${l.brand2};
${mid(l.mid)}  --brand-foreground: ${LABEL.light};
  --background: ${l.background};
  --foreground: ${l.foreground};
  --surface: #ffffff;
  --surface-muted: ${l.muted};
  --surface-sunken: ${l.muted};
  --card: #ffffff;
  --card-foreground: ${l.foreground};
  --popover: #ffffff;
  --popover-foreground: ${l.foreground};
  --secondary: ${l.muted};
  --secondary-foreground: ${l.foreground};
  --muted: ${l.muted};
  --muted-foreground: ${l.mutedFg};
  --kicker: ${l.mutedFg};
  --accent: ${l.muted};
  --accent-foreground: ${l.foreground};
  --glow-primary: 0 0 30px -8px rgba(${rgbOf(l.brand).join(", ")}, 0.35);
  ${washDeclaration(l.wash)}
  --content-surface: #ffffff;
}

.dark[data-theme-preset="${p.id}"] {
  --brand: ${d.brand};
  --brand-2: ${d.brand2};
${mid(d.mid)}  --brand-foreground: ${LABEL.dark};
  --background: ${d.background};
  --foreground: ${d.foreground};
  --surface: ${d.surface};
  --surface-muted: ${d.muted};
  --surface-sunken: ${d.muted};
  --card: ${d.surface};
  --card-foreground: ${d.foreground};
  --popover: ${d.muted};
  --popover-foreground: ${d.foreground};
  --secondary: ${d.secondary};
  --secondary-foreground: ${d.foreground};
  --muted: ${d.muted};
  --muted-foreground: ${d.mutedFg};
  --kicker: ${d.mutedFg};
  --accent: ${d.muted};
  --accent-foreground: ${d.foreground};
  ${washDeclaration(d.wash)}
  --content-surface: ${d.background};
}
`;
}

/** One preset's entry in THEME_PRESETS: the swatch mirrors the mid wash stop
 *  (light) / top wash stop (dark) and the two accents. */
export function registryValue(p) {
  const { light: l, dark: d } = presetValues(p);
  return {
    id: p.id,
    label: p.label,
    swatch: {
      light: { chrome: l.wash[1], accent: l.brand, accent2: l.brand2 },
      dark: { chrome: d.wash[0], accent: d.brand, accent2: d.brand2 },
    },
  };
}

/** `registryValue` as presets.ts source, exactly as prettier leaves it. */
export function registryEntry(p) {
  const { id, label, swatch } = registryValue(p);
  const mode = (m) =>
    `      ${m}: { chrome: "${swatch[m].chrome}", accent: "${swatch[m].accent}", accent2: "${swatch[m].accent2}" },`;
  return `  {
    id: "${id}",
    label: "${label}",
    swatch: {
${mode("light")}
${mode("dark")}
    },
  },`;
}

// CLI — only when run directly, never when a test imports the module.
//   wash <h1> <h2> [cs] [brand] [brand2] [brandMid]   one wash
//   base                                              the five shipped washes
//   presets                                           the twelve generated presets
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
  } else if (command === "presets") {
    for (const p of NEW_PRESETS) console.log(cssBlocks(p));
    console.log("// ---- presets.ts ----");
    for (const p of NEW_PRESETS) console.log(registryEntry(p));
  } else {
    console.error(
      "usage: node scripts/theme/gen-presets.mjs wash <h1> <h2> [cs] [brand brand2 [brandMid]] | base | presets",
    );
    process.exitCode = 1;
  }
}
