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
      }
  });

  it("narrows unknown stored values", () => {
    expect(isThemePresetId("ocean")).toBe(true);
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
