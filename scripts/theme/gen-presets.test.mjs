import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_WASHES,
  BLOOM_VISIBLE,
  CHROME_DESTRUCTIVE,
  CHROME_FILL_ALPHA,
  CHROME_MUTED_ALPHA,
  CHROME_SELECTED_ALPHA,
  LIGHT_BLOOM,
  chromeContrasts,
  contrastHex,
  groundsOf,
  oklchToHex,
  MIN_STEPS,
  NEW_PRESETS,
  TARGET,
  cssBlocks,
  faintestBloom,
  presetValues,
  registryEntry,
  registryValue,
  overlappingRadials,
  solveBoldWash,
  solveBoldWashDetailed,
  washHue,
  washDeclaration,
  worstChromeContrast,
} from "./gen-presets.mjs";
import { THEME_PRESET_IDS, THEME_PRESETS } from "../../src/lib/theme/presets";

/**
 * The generator restates three things the stylesheet owns — the chrome
 * scope's muted, selected and resting-fill alphas and the light bloom — because it has to
 * solve against them. These tests read globals.css and fail when either side
 * moves alone, and pin the five shipped light washes and the twelve generated
 * presets (both blocks and the registry entry of each) to the script's
 * output, so "regenerate and paste" stays a true description of how they
 * were made.
 */
const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function blockOf(selector) {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  return CSS.slice(start, CSS.indexOf("\n}", start));
}

function declaration(selector, token) {
  const m = blockOf(selector).match(
    new RegExp(`^\\s{2}${token}:\\s*([^;]+);`, "m"),
  );
  if (!m) throw new Error(`${token} not declared in ${selector}`);
  return m[1].trim();
}

const SCOPE = ":root:not(.dark) .chrome-scope";
const whiteAlpha = (token) =>
  Number(
    declaration(SCOPE, token).match(/^rgb\(255 255 255 \/ ([\d.]+)%\)$/)[1],
  ) / 100;

describe("gen-presets constants match globals.css", () => {
  it("the chrome scope's muted and selected alphas", () => {
    expect(whiteAlpha("--muted-foreground")).toBe(CHROME_MUTED_ALPHA);
    expect(whiteAlpha("--kicker")).toBe(CHROME_MUTED_ALPHA);
    expect(whiteAlpha("--state-selected")).toBe(CHROME_SELECTED_ALPHA);
  });

  it("the chrome scope's resting fill alpha", () => {
    expect(whiteAlpha("--chrome-fill")).toBe(CHROME_FILL_ALPHA);
  });

  it("the chrome scope's error red", () => {
    expect(declaration(SCOPE, "--destructive")).toBe(CHROME_DESTRUCTIVE);
  });

  it("the light bloom's geometry, tint and peaks", () => {
    const pct = "(-?\\d+(?:\\.\\d+)?)%";
    const radials = [
      ...declaration(":root", "--app-bloom").matchAll(
        new RegExp(
          `radial-gradient\\(\\s*${pct} ${pct} at ${pct} ${pct},\\s*` +
            `color-mix\\(\\s*in srgb,\\s*color-mix\\(in srgb, var\\(--brand(?:-2|-mid)?\\) ${pct}, white\\) ${pct},` +
            `\\s*transparent\\s*\\)\\s*0%,\\s*transparent ${pct}\\s*\\)`,
          "g",
        ),
      ),
    ].map((m) => m.slice(1).map((v) => Number(v) / 100));
    expect(radials).toHaveLength(3);
    expect(
      radials.map(([rx, ry, cx, cy, , , reach]) => ({ rx, ry, cx, cy, reach })),
    ).toEqual(LIGHT_BLOOM.radials);
    expect(radials.map((r) => r[4])).toEqual([
      LIGHT_BLOOM.tint,
      LIGHT_BLOOM.tint,
      LIGHT_BLOOM.tint,
    ]);
    expect(radials.map((r) => r[5])).toEqual(LIGHT_BLOOM.peaks);
  });
});

const selectorOf = (id) =>
  id === "keystone" ? ":root" : `:root[data-theme-preset="${id}"]`;

describe("solveBoldWash", () => {
  it.each(Object.entries(BASE_WASHES))(
    "solves %s against the accents the stylesheet actually declares",
    (id, { accents }) => {
      expect(accents).toEqual([
        declaration(selectorOf(id), "--brand"),
        declaration(selectorOf(id), "--brand-2"),
      ]);
    },
  );

  it.each(Object.entries(BASE_WASHES))(
    "reproduces the shipped light wash of %s",
    (id, { hues, cs, accents }) => {
      expect(`--app-wash: ${declaration(selectorOf(id), "--app-wash")};`).toBe(
        washDeclaration(solveBoldWash(...hues, cs, accents)),
      );
    },
  );

  it("every stop clears its target against a pure-white bloom, at any hue", () => {
    // No accents given: the solver assumes the most pessimistic bloom.
    for (let h = 0; h < 360; h += 15) {
      for (const stop of solveBoldWash(h, h + 60)) {
        expect(
          worstChromeContrast(stop),
          `${stop} from hue ${h}`,
        ).toBeGreaterThanOrEqual(TARGET);
      }
    }
  });

  it.each(Object.entries(BASE_WASHES))(
    "every stop of %s clears its target under the preset's own bloom, in descending lightness",
    (_id, { hues, cs, accents }) => {
      const solved = solveBoldWashDetailed(...hues, cs, accents);
      for (const { stop } of solved) {
        expect(worstChromeContrast(stop, accents), stop).toBeGreaterThanOrEqual(
          TARGET,
        );
        expect(faintestBloom(stop, accents), stop).toBeGreaterThanOrEqual(
          BLOOM_VISIBLE,
        );
      }
      expect(solved[0].L - solved[1].L).toBeGreaterThanOrEqual(
        MIN_STEPS[0] - 1e-9,
      );
      expect(solved[1].L - solved[2].L).toBeGreaterThanOrEqual(
        MIN_STEPS[1] - 1e-9,
      );
    },
  );

  it("pulls a brown wash hue (50–95) to burnt orange and leaves the rest", () => {
    expect(washHue(62)).toBe(45);
    expect(washHue(50)).toBe(45);
    expect(washHue(95)).toBe(45);
    expect(washHue(49)).toBe(49);
    expect(washHue(96)).toBe(96);
    expect(washHue(128)).toBe(128);
    expect(washHue(-90)).toBe(270);
  });

  it("counts muted text on the resting chrome fill among the worst cases", () => {
    // The ⌘K kbd and the chip's org kicker: white at the muted alpha on white
    // at the fill alpha. globals.contrast.test.ts asserts it for every preset;
    // the solver must see the same case or it can emit a wash that fails it.
    const hex = (v) => "#" + v.toString(16).padStart(2, "0").repeat(3);
    const over = (alpha, bg) => Math.round(alpha * 255 + (1 - alpha) * bg);
    for (const grey of [40, 70, 100, 130]) {
      const fill = over(CHROME_FILL_ALPHA, grey);
      const checks = chromeContrasts(hex(grey));
      expect(Object.keys(checks).sort()).toEqual([
        "destructive",
        "muted",
        "mutedOnFill",
        "selected",
      ]);
      expect(checks.mutedOnFill).toBeCloseTo(
        contrastHex(hex(over(CHROME_MUTED_ALPHA, fill)), hex(fill)),
        10,
      );
      // …and it is tighter than muted text on the bare ground.
      expect(checks.mutedOnFill).toBeLessThan(checks.muted);
      // The worst case is the minimum of every check on every ground.
      expect(worstChromeContrast(hex(grey))).toBe(
        Math.min(
          ...groundsOf(hex(grey)).flatMap((g) =>
            Object.values(chromeContrasts(g)),
          ),
        ),
      );
    }
  });

  it("stacks only the radials whose lit ellipses meet", () => {
    // Today none do, so every ground is one radial at its own peak.
    expect(overlappingRadials(LIGHT_BLOOM.radials)).toEqual([[0], [1], [2]]);
  });
});

describe("generated presets", () => {
  const PRESETS_TS = readFileSync(
    resolve(process.cwd(), "src/lib/theme/presets.ts"),
    "utf8",
  );

  it("are the twelve ids after nebula, in registry order", () => {
    expect(NEW_PRESETS.map((p) => p.id)).toEqual(
      [...THEME_PRESET_IDS].slice(THEME_PRESET_IDS.indexOf("nebula") + 1),
    );
    expect(NEW_PRESETS).toHaveLength(12);
  });

  it.each(NEW_PRESETS.map((p) => [p.id, p]))(
    "reproduces both shipped blocks of %s, comment and all",
    (_id, p) => {
      expect(CSS).toContain(cssBlocks(p));
    },
  );

  it.each(NEW_PRESETS.map((p) => [p.id, p]))(
    "reproduces the shipped registry entry of %s",
    (id, p) => {
      expect(THEME_PRESETS.find((entry) => entry.id === id)).toEqual(
        registryValue(p),
      );
      expect(PRESETS_TS).toContain(registryEntry(p));
    },
  );

  it.each(NEW_PRESETS.map((p) => [p.id, p]))(
    "solves the light wash of %s under its own generated accents",
    (_id, p) => {
      const { light } = presetValues(p);
      const accents = [light.brand, light.brand2, light.mid].filter(Boolean);
      expect(accents).toHaveLength(p.mid == null ? 2 : 3);
      const solved = solveBoldWashDetailed(p.h1, p.h2, p.cs ?? 1, accents);
      expect(solved.map((s) => s.stop)).toEqual(light.wash);
      for (const { stop } of solved) {
        expect(worstChromeContrast(stop, accents), stop).toBeGreaterThanOrEqual(
          TARGET,
        );
        expect(faintestBloom(stop, accents), stop).toBeGreaterThanOrEqual(
          BLOOM_VISIBLE,
        );
      }
      expect(solved[0].L - solved[1].L).toBeGreaterThanOrEqual(
        MIN_STEPS[0] - 1e-9,
      );
      expect(solved[1].L - solved[2].L).toBeGreaterThanOrEqual(
        MIN_STEPS[1] - 1e-9,
      );
    },
  );

  it.each(NEW_PRESETS.map((p) => [p.id, p]))(
    "the registry swatch of %s is the first and last wash stop and both accents, per mode",
    (_id, p) => {
      const values = presetValues(p);
      const { swatch } = registryValue(p);
      for (const mode of ["light", "dark"]) {
        expect(values[mode].wash).toHaveLength(3);
        expect(swatch[mode]).toEqual({
          chrome: values[mode].wash[0],
          chrome2: values[mode].wash[2],
          accent: values[mode].brand,
          accent2: values[mode].brand2,
        });
      }
    },
  );

  it("only Prism carries a third, middle accent", () => {
    expect(NEW_PRESETS.filter((p) => p.mid != null).map((p) => p.id)).toEqual([
      "prism",
    ]);
  });
});

describe("colour helpers", () => {
  it("converts OKLCH to sRGB hex and clamps chroma into gamut", () => {
    expect(oklchToHex(1, 0, 0)).toBe("#ffffff");
    expect(oklchToHex(0, 0, 0)).toBe("#000000");
    // Far outside sRGB at this lightness: still a valid six-digit hex.
    expect(oklchToHex(0.5, 0.4, 272)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("matches published OKLCH reference colours, not just itself", () => {
    // Independent of this module: CSS Color 4's own conversions of the sRGB
    // primaries, and a chromatic mid-tone (rebeccapurple).
    expect(oklchToHex(0.62796, 0.25768, 29.234)).toBe("#ff0000");
    expect(oklchToHex(0.45201, 0.31321, 264.052)).toBe("#0000ff");
    expect(oklchToHex(0.86644, 0.29483, 142.495)).toBe("#00ff00");
    expect(oklchToHex(0.44027, 0.1603, 303.37)).toBe("#663399");
    // An achromatic mid-tone: 50% grey is L 0.59987.
    expect(oklchToHex(0.59987, 0, 0)).toBe("#808080");
  });

  it("contrastHex is the WCAG ratio", () => {
    expect(contrastHex("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastHex("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });
});
