import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  THEME_PRESET_IDS,
  DEFAULT_THEME_PRESET,
  THEME_PRESETS,
  THEME_PRESET_ATTR,
  applyThemePreset,
  isThemePresetId,
  swatchAccentFill,
  THEME_REACH_IDS,
  DEFAULT_THEME_REACH,
  THEME_REACH_STORAGE_KEY,
  THEME_REACH_ATTR,
  applyThemeReach,
  isThemeReachId,
} from "./presets";

const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * The seed set: every token a preset is allowed to move. Anything alpha-based
 * (`--border`, `--state-*`, `--chrome-fill`) or brand-derived (`--primary`,
 * `--ring`, `--sidebar-primary`) follows on its own and must NOT be redeclared —
 * a preset block that lists more or fewer tokens than this fails, which is what
 * keeps a new preset from silently forgetting half the palette.
 */
const SEEDS = [
  "--brand",
  "--brand-2",
  "--brand-foreground",
  "--app-wash",
  "--app-bloom",
  "--background",
  "--foreground",
  "--surface",
  "--surface-muted",
  "--surface-sunken",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--kicker",
  "--accent",
  "--accent-foreground",
  "--content-surface",
];

function block(sel: string) {
  const s = CSS.indexOf(`${sel} {`);
  if (s === -1) return null;
  return CSS.slice(s, CSS.indexOf("\n}", s));
}
function tokens(b: string) {
  return new Set([...b.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((m) => m[1]));
}

describe("theme presets", () => {
  it("every non-default preset has light + dark override blocks with exactly the seed tokens", () => {
    for (const id of THEME_PRESET_IDS.filter(
      (i) => i !== DEFAULT_THEME_PRESET,
    )) {
      for (const sel of [
        `:root[data-theme-preset="${id}"]`,
        `.dark[data-theme-preset="${id}"]`,
      ]) {
        const b = block(sel);
        expect(b, `${sel} missing`).not.toBeNull();
        const t = [...tokens(b!)].sort();
        // The light bloom is a `rgba(--brand)` shadow too, so light blocks also
        // re-seed --glow-primary; the dark glow is white and theme-invariant.
        const want = [
          ...SEEDS,
          ...(sel.startsWith(":root") ? ["--glow-primary"] : []),
        ].sort();
        expect(t, sel).toEqual(want);
      }
    }
  });

  it("the default preset ships no override block (it IS :root/.dark)", () => {
    expect(CSS).not.toContain(`data-theme-preset="${DEFAULT_THEME_PRESET}"`);
  });

  it("no CSS preset block without a TS entry", () => {
    const ids = new Set(
      [...CSS.matchAll(/data-theme-preset="([a-z0-9-]+)"/g)].map((m) => m[1]),
    );
    for (const id of ids) expect(isThemePresetId(id), id).toBe(true);
  });

  it("every id has exactly one entry, in declaration order", () => {
    expect(THEME_PRESETS.map((p) => p.id)).toEqual([...THEME_PRESET_IDS]);
  });

  it("swatches are hex", () => {
    for (const p of THEME_PRESETS)
      for (const m of ["light", "dark"] as const) {
        expect(p.swatch[m].chrome).toMatch(/^#[0-9a-f]{6}$/);
        expect(p.swatch[m].accent).toMatch(/^#[0-9a-f]{6}$/);
        const { accent2 } = p.swatch[m];
        if (accent2 !== undefined) expect(accent2).toMatch(/^#[0-9a-f]{6}$/);
      }
  });

  /** One declared value out of a palette block (`:root` / `.dark` for keystone). */
  function seed(id: string, mode: "light" | "dark", token: string) {
    const base = mode === "light" ? ":root" : ".dark";
    const b = block(
      id === DEFAULT_THEME_PRESET ? base : `${base}[data-theme-preset="${id}"]`,
    );
    return b?.match(new RegExp(`^\\s{2}${token}:\\s*([^;]+);`, "m"))?.[1];
  }

  it("swatch accents mirror the stylesheet's --brand and --brand-2", () => {
    for (const p of THEME_PRESETS)
      for (const m of ["light", "dark"] as const) {
        const where = `${p.id} ${m}`;
        const brand = seed(p.id, m, "--brand");
        const brand2 = seed(p.id, m, "--brand-2");
        expect(p.swatch[m].accent, where).toBe(brand);
        // A second accent is listed exactly when the block has a second hue:
        // a single-accent preset's --brand-2 is its own --brand, and its dot
        // stays flat.
        expect(p.swatch[m].accent2, where).toBe(
          brand2 === brand ? undefined : brand2,
        );
      }
  });

  it("swatchAccentFill is flat for one accent and a 90deg gradient for two", () => {
    expect(swatchAccentFill({ chrome: "#000000", accent: "#112233" })).toBe(
      "#112233",
    );
    expect(
      swatchAccentFill({
        chrome: "#000000",
        accent: "#112233",
        accent2: "#445566",
      }),
    ).toBe("linear-gradient(90deg, #112233, #445566)");
  });

  it("ships exactly three two-accent presets, after the single-accent ones", () => {
    const twoAccent = THEME_PRESETS.filter(
      (p) => p.swatch.light.accent2 && p.swatch.dark.accent2,
    ).map((p) => p.id);
    expect(twoAccent).toEqual(["aurora", "sunset", "nebula"]);
    expect([...THEME_PRESET_IDS].slice(-3)).toEqual(twoAccent);
  });

  it("derives --brand-gradient once, in :root, from the two brand seeds", () => {
    expect(CSS.match(/^\s*--brand-gradient:/gm)).toHaveLength(2); // :root + print root
    expect(block(":root")).toContain(
      "--brand-gradient: linear-gradient(90deg, var(--brand), var(--brand-2));",
    );
    expect(block(".dark")).not.toMatch(/--brand-gradient:/);
    expect(block(":root")).toMatch(/^\s{2}--brand-2:/m);
    expect(block(".dark")).toMatch(/^\s{2}--brand-2:/m);
  });

  it("narrows unknown stored values", () => {
    expect(isThemePresetId("ocean")).toBe(true);
    expect(isThemePresetId("aurora")).toBe(true);
    expect(isThemePresetId("teal")).toBe(false);
    expect(isThemePresetId(null)).toBe(false);
  });

  it("applyThemePreset stamps the attribute and removes it for the default", () => {
    applyThemePreset("ocean");
    expect(document.documentElement.getAttribute(THEME_PRESET_ATTR)).toBe(
      "ocean",
    );
    applyThemePreset(DEFAULT_THEME_PRESET);
    expect(document.documentElement.hasAttribute(THEME_PRESET_ATTR)).toBe(
      false,
    );
  });
});

describe("theme reach", () => {
  it("declares the three levels, tinted by default", () => {
    expect([...THEME_REACH_IDS]).toEqual(["subtle", "tinted", "vivid"]);
    expect(DEFAULT_THEME_REACH).toBe("tinted");
    expect(THEME_REACH_STORAGE_KEY).toBe("monolith-theme-reach");
    expect(THEME_REACH_ATTR).toBe("data-theme-reach");
  });

  it("narrows unknown stored values", () => {
    for (const id of THEME_REACH_IDS) expect(isThemeReachId(id)).toBe(true);
    expect(isThemeReachId("loud")).toBe(false);
    expect(isThemeReachId("")).toBe(false);
    expect(isThemeReachId(null)).toBe(false);
    expect(isThemeReachId(1)).toBe(false);
  });

  it("applyThemeReach stamps the attribute and removes it for the default", () => {
    applyThemeReach("vivid");
    expect(document.documentElement.getAttribute(THEME_REACH_ATTR)).toBe(
      "vivid",
    );
    applyThemeReach("subtle");
    expect(document.documentElement.getAttribute(THEME_REACH_ATTR)).toBe(
      "subtle",
    );
    applyThemeReach(DEFAULT_THEME_REACH);
    expect(document.documentElement.hasAttribute(THEME_REACH_ATTR)).toBe(false);
  });

  it("has a CSS block for every non-default level and none for the default", () => {
    for (const id of THEME_REACH_IDS.filter((i) => i !== DEFAULT_THEME_REACH))
      expect(CSS, id).toContain(`[${THEME_REACH_ATTR}="${id}"] {`);
    expect(CSS).not.toContain(`${THEME_REACH_ATTR}="${DEFAULT_THEME_REACH}"`);
  });

  it("no preset block declares a reach token — reach is a derived layer", () => {
    for (const id of THEME_PRESET_IDS.filter((i) => i !== DEFAULT_THEME_PRESET))
      for (const sel of [
        `:root[data-theme-preset="${id}"]`,
        `.dark[data-theme-preset="${id}"]`,
      ])
        expect(block(sel), sel).not.toMatch(/--reach-/);
  });
});
