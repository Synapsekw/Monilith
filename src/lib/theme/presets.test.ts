import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio } from "@/lib/boards/contrast";
import {
  THEME_PRESET_IDS,
  type ThemePresetId,
  DEFAULT_THEME_PRESET,
  THEME_PRESETS,
  THEME_PRESET_ATTR,
  applyThemePreset,
  isThemePresetId,
  LEGACY_THEME_PRESET_ALIASES,
  resolveThemePresetId,
  swatchAccentFill,
  swatchAccentRing,
  swatchChromeFill,
  SWATCH_MIN_CONTRAST,
  SWATCH_RING_ALPHA,
  type ThemePresetSwatch,
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
 * `--ring`, `--sidebar-primary`, `--brand-gradient`, `--app-bloom`) follows on
 * its own and must NOT be redeclared — a preset block that lists more or fewer
 * tokens than this fails, which is what keeps a new preset from silently
 * forgetting half the palette. One token is optional: `--brand-mid`, the
 * gradient's middle stop, is derived in `:root` and only Prism declares it.
 */
const SEEDS = [
  "--brand",
  "--brand-2",
  "--brand-foreground",
  "--app-wash",
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

/** Presets allowed to seed the optional `--brand-mid`. */
const OWN_BRAND_MID: readonly ThemePresetId[] = ["prism"];

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
        ];
        if (OWN_BRAND_MID.includes(id)) want.push("--brand-mid");
        want.sort();
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
        expect(p.swatch[m].chrome2).toMatch(/^#[0-9a-f]{6}$/);
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

  it("swatch chrome mirrors the first and last wash stop of each mode", () => {
    for (const p of THEME_PRESETS)
      for (const m of ["light", "dark"] as const) {
        const stops = seed(p.id, m, "--app-wash")!.match(/#[0-9a-f]{6}/gi)!;
        expect(stops, `${p.id} ${m}`).toHaveLength(3);
        expect(p.swatch[m].chrome, `${p.id} ${m}`).toBe(stops[0]);
        expect(p.swatch[m].chrome2, `${p.id} ${m}`).toBe(
          stops[stops.length - 1],
        );
      }
  });

  it("swatchChromeFill is a diagonal gradient of the two chrome stops", () => {
    expect(
      swatchChromeFill({
        chrome: "#111111",
        chrome2: "#222222",
        accent: "#333333",
      }),
    ).toBe("linear-gradient(135deg, #111111, #222222)");
  });

  it("swatchAccentFill is flat for one accent and a 90deg gradient for two", () => {
    expect(
      swatchAccentFill({
        chrome: "#000000",
        chrome2: "#000000",
        accent: "#112233",
      }),
    ).toBe("#112233");
    expect(
      swatchAccentFill({
        chrome: "#000000",
        chrome2: "#000000",
        accent: "#112233",
        accent2: "#445566",
      }),
    ).toBe("linear-gradient(90deg, #112233, #445566)");
  });

  describe("swatchAccentRing", () => {
    const RING = `0 0 0 1px rgba(255, 255, 255, ${SWATCH_RING_ALPHA})`;
    const rgb = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    /** `fg` at `alpha` over an opaque `bg`. */
    const over = (fg: string, alpha: number, bg: string) =>
      "#" +
      rgb(fg)
        .map((c, i) =>
          Math.round(alpha * c + (1 - alpha) * rgb(bg)[i])
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    const accentsOf = (s: ThemePresetSwatch) =>
      s.accent2 === undefined ? [s.accent] : [s.accent, s.accent2];
    /** Everything the dot can sit on: both ends of the tile's gradient and
     *  the even mix between them, which is what is under a centred dot. */
    const groundsOf = (s: ThemePresetSwatch) => [
      s.chrome,
      s.chrome2,
      over(s.chrome, 0.5, s.chrome2),
    ];

    it("rings a dot exactly when an accent is under 3:1 on either chrome stop", () => {
      const base = { chrome: "#202020", chrome2: "#101010" };
      // Pale accent on a near-black ground: carries itself.
      expect(swatchAccentRing({ ...base, accent: "#dddddd" })).toBeUndefined();
      // Same ground, an accent as dark as the ground: sinks.
      expect(swatchAccentRing({ ...base, accent: "#303030" })).toBe(RING);
      // One sinking accent out of two is enough …
      expect(
        swatchAccentRing({ ...base, accent: "#dddddd", accent2: "#303030" }),
      ).toBe(RING);
      // … and so is one stop out of two.
      expect(
        swatchAccentRing({
          chrome: "#202020",
          chrome2: "#bbbbbb",
          accent: "#dddddd",
        }),
      ).toBe(RING);
      expect(SWATCH_MIN_CONTRAST).toBe(3);
    });

    it("every dot is legible on its own wash: by its fill, or by a ring that clears 3:1 on both sides", () => {
      for (const p of THEME_PRESETS)
        for (const m of ["light", "dark"] as const) {
          const s = p.swatch[m];
          const where = `${p.id} ${m}`;
          if (swatchAccentRing(s) === undefined) {
            for (const a of accentsOf(s))
              for (const g of groundsOf(s))
                expect(
                  contrastRatio(a, g),
                  `${where}: ${a} on ${g}`,
                ).toBeGreaterThanOrEqual(SWATCH_MIN_CONTRAST);
            continue;
          }
          expect(swatchAccentRing(s), where).toBe(RING);
          for (const g of groundsOf(s)) {
            const ring = over("#ffffff", SWATCH_RING_ALPHA, g);
            expect(
              contrastRatio(ring, g),
              `${where}: ring on ${g}`,
            ).toBeGreaterThanOrEqual(SWATCH_MIN_CONTRAST);
            for (const a of accentsOf(s))
              expect(
                contrastRatio(ring, a),
                `${where}: ring around ${a} on ${g}`,
              ).toBeGreaterThanOrEqual(SWATCH_MIN_CONTRAST);
          }
        }
    });

    it("today: every light dot is ringed and no dark one is", () => {
      for (const p of THEME_PRESETS) {
        expect(swatchAccentRing(p.swatch.light), p.id).toBe(RING);
        expect(swatchAccentRing(p.swatch.dark), p.id).toBeUndefined();
      }
    });
  });

  it("ships fifteen two-accent presets after the two single-accent ones", () => {
    expect([...THEME_PRESET_IDS]).toEqual([
      "keystone",
      "graphite",
      "aurora",
      "sunset",
      "nebula",
      "lagoon",
      "tropic",
      "orchid",
      "peach",
      "glacier",
      "dusk",
      "berry",
      "candy",
      "citrus",
      "prism",
      "mocha",
      "neon",
    ]);
    const twoAccent = THEME_PRESETS.filter(
      (p) => p.swatch.light.accent2 && p.swatch.dark.accent2,
    ).map((p) => p.id);
    expect(twoAccent).toEqual([...THEME_PRESET_IDS].slice(2));
  });

  it("derives --brand-mid, --brand-gradient and --app-bloom from the seeds, never in a preset block", () => {
    // Derived once (:root) and re-seeded only where a subtree re-seeds the
    // brand itself: the print root, and the light chrome scope with its reset
    // (white on the bold frame, then back to the root gradient) and its print
    // fallback (back to the root gradient again, for paper).
    expect(CSS.match(/^\s*--brand-gradient:/gm)).toHaveLength(5);
    for (const sel of [
      ":root:not(.dark) .chrome-scope",
      ":root:not(.dark) .chrome-scope .chrome-reset",
    ])
      expect(block(sel), sel).toMatch(/^\s{2}--brand-gradient:/m);
    expect(block(":root")).toContain(
      "--brand-mid: color-mix(in srgb, var(--brand), var(--brand-2));",
    );
    expect(block(":root")).toContain(
      "--brand-gradient: linear-gradient(\n    90deg,\n    var(--brand),\n    var(--brand-mid),\n    var(--brand-2)\n  );",
    );
    expect(block(".dark")).not.toMatch(/--brand-gradient:|--brand-mid:/);
    expect(block(":root")).toMatch(/^\s{2}--brand-2:/m);
    expect(block(".dark")).toMatch(/^\s{2}--brand-2:/m);
    for (const sel of [":root", ".dark"])
      expect(block(sel), sel).toMatch(/^\s{2}--app-bloom:/m);
    for (const id of THEME_PRESET_IDS.filter((i) => i !== DEFAULT_THEME_PRESET))
      for (const base of [":root", ".dark"]) {
        const b = block(`${base}[data-theme-preset="${id}"]`)!;
        expect(b, id).not.toMatch(/--app-bloom:|--brand-gradient:/);
        if (!OWN_BRAND_MID.includes(id))
          expect(b, id).not.toMatch(/--brand-mid:/);
      }
  });

  it("narrows unknown stored values", () => {
    expect(isThemePresetId("graphite")).toBe(true);
    expect(isThemePresetId("aurora")).toBe(true);
    expect(isThemePresetId("neon")).toBe(true);
    expect(isThemePresetId("teal")).toBe(false);
    expect(isThemePresetId(null)).toBe(false);
  });

  it("applyThemePreset stamps the attribute and removes it for the default", () => {
    applyThemePreset("graphite");
    expect(document.documentElement.getAttribute(THEME_PRESET_ATTR)).toBe(
      "graphite",
    );
    applyThemePreset(DEFAULT_THEME_PRESET);
    expect(document.documentElement.hasAttribute(THEME_PRESET_ATTR)).toBe(
      false,
    );
  });
});

describe("legacy preset aliases", () => {
  it("maps each removed id to a replacement", () => {
    expect(LEGACY_THEME_PRESET_ALIASES).toEqual({
      ocean: "lagoon",
      forest: "tropic",
      ember: "peach",
      rose: "orchid",
    });
  });

  it("the removed ids are no longer presets and have no CSS block", () => {
    for (const id of ["ocean", "forest", "ember", "rose"]) {
      expect(isThemePresetId(id), id).toBe(false);
      expect(CSS).not.toContain(`data-theme-preset="${id}"`);
    }
  });

  it("resolveThemePresetId returns current ids, follows aliases that exist, and defaults otherwise", () => {
    expect(resolveThemePresetId("aurora")).toBe("aurora");
    expect(resolveThemePresetId("ocean")).toBe("lagoon");
    expect(resolveThemePresetId("forest")).toBe("tropic");
    expect(resolveThemePresetId("ember")).toBe("peach");
    expect(resolveThemePresetId("rose")).toBe("orchid");
    expect(resolveThemePresetId("teal")).toBe(DEFAULT_THEME_PRESET);
    expect(resolveThemePresetId(null)).toBe(DEFAULT_THEME_PRESET);
    for (const [legacy, target] of Object.entries(LEGACY_THEME_PRESET_ALIASES))
      expect(resolveThemePresetId(legacy)).toBe(
        isThemePresetId(target) ? target : DEFAULT_THEME_PRESET,
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
