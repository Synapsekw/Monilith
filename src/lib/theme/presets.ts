/**
 * Theme presets — a per-user choice of accent, neutral tint and chrome wash.
 *
 * A preset is NOT a third mode alongside light/dark: it re-seeds a handful of
 * tokens inside whichever mode is active. `keystone` is the shipped default and
 * deliberately has NO CSS block — it IS `:root` / `.dark`, so the default costs
 * nothing and can never drift from the base palette. Every other preset gets two
 * override blocks in `src/app/globals.css`
 * (`:root[data-theme-preset="<id>"]` and `.dark[data-theme-preset="<id>"]`)
 * declaring exactly the seed tokens; everything alpha-based (`--border`,
 * `--state-*`) or brand-derived (`--primary`, `--ring`, `--app-bloom`) follows
 * on its own.
 *
 * `--brand-2` is one of those seeds. Keystone and Graphite are single-accent and
 * declare it equal to `--brand`; every other preset gives it a second hue,
 * which is all that makes them "gradient" presets — `--brand-gradient` is
 * derived once in `:root` from the two. The twelve after `nebula` are
 * generated: their blocks and entries are the output of
 * `node scripts/theme/gen-presets.mjs presets`, pasted, and
 * `scripts/theme/gen-presets.test.mjs` fails when either is edited by hand.
 *
 * Adding a preset means three things, all guarded by tests: an entry here, the
 * two CSS blocks (`presets.test.ts` checks the token sets match exactly), and a
 * green `globals.contrast.test.ts` (which iterates this list).
 */

import { contrastRatio } from "@/lib/boards/contrast";

export const THEME_PRESET_IDS = [
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
] as const;

export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

/** The base palette. Has no override block — `:root` / `.dark` are its block. */
export const DEFAULT_THEME_PRESET: ThemePresetId = "keystone";

/** localStorage key read by the inline no-flash script in `layout.tsx`. */
export const THEME_PRESET_STORAGE_KEY = "pulse-theme-preset";

/** Attribute stamped on `<html>`. Absent means the default preset. */
export const THEME_PRESET_ATTR = "data-theme-preset";

/** Keystone's brand hex per mode — the swatch below and the settings tile both
 *  need it as a literal, and it is the one preset with no CSS block to read. */
export const KEYSTONE_BRAND_HEX = {
  light: "#5a6ed5",
  dark: "#8ea2eb",
} as const;

/** One mode's preview. `chrome` → `chrome2` mirror the first and last stop of
 *  that mode's `--app-wash`: the frame the app is actually drawn on. `accent2`
 *  mirrors `--brand-2` and is set ONLY by the two-accent presets (everything
 *  but Keystone and Graphite): its presence is what turns the accent dot into
 *  a two-stop gradient. */
export type ThemePresetSwatch = {
  chrome: string;
  chrome2: string;
  accent: string;
  accent2?: string;
};

/** The tile ground: the mode's wash, first stop to last. */
export function swatchChromeFill({
  chrome,
  chrome2,
}: ThemePresetSwatch): string {
  return `linear-gradient(135deg, ${chrome}, ${chrome2})`;
}

/** The CSS `background` for a swatch's accent dot: flat for a single-accent
 *  preset; the same two stops and direction as `--brand-gradient` when the
 *  preset carries a second one. Shared by every surface that previews presets. */
export function swatchAccentFill({
  accent,
  accent2,
}: ThemePresetSwatch): string {
  return accent2 ? `linear-gradient(90deg, ${accent}, ${accent2})` : accent;
}

/** WCAG 1.4.11: a graphic has to stand 3:1 off what it is drawn on. */
export const SWATCH_MIN_CONTRAST = 3;

/** The ring's white, as an alpha over the wash. White is what the light frame
 *  itself draws with (`.chrome-scope` re-seeds `--primary` to `#ffffff`), so
 *  the ring is the frame's own ink rather than a new colour. */
export const SWATCH_RING_ALPHA = 0.9;

/**
 * The hairline that keeps an accent dot legible ON ITS OWN WASH, as a CSS
 * `box-shadow` — or `undefined` when the dot needs none.
 *
 * The rule is computed from the swatch, never keyed on the mode: a ring is
 * drawn exactly when some accent sits under 3:1 against either end of the
 * ground. Today that is every light swatch and no dark one. A light accent is
 * a mid-dark, white-label colour and the light wash is a saturated mid-dark
 * frame in the same hue, so the bare dot would sink into it (1.1:1 for
 * Graphite); a dark accent is pale on a near-black wash and carries itself.
 * Where the ring is drawn it clears 3:1 against BOTH the wash outside it and
 * the accent inside it — the wash is solved for white text and the accent for
 * a white label — so the dot's outline is always readable and its fill stays
 * the true accent. `presets.test.ts` pins all of this for every preset.
 *
 * Only for a dot drawn on `swatchChromeFill`. A surface that shows the dot on
 * the ordinary popover or card (the header theme menu) needs no ring: the
 * accents are AA there by `globals.contrast.test.ts`.
 */
export function swatchAccentRing({
  chrome,
  chrome2,
  accent,
  accent2,
}: ThemePresetSwatch): string | undefined {
  const sinks = [accent, accent2].some(
    (a) =>
      a !== undefined &&
      [chrome, chrome2].some(
        (ground) => contrastRatio(a, ground) < SWATCH_MIN_CONTRAST,
      ),
  );
  return sinks
    ? `0 0 0 1px rgba(255, 255, 255, ${SWATCH_RING_ALPHA})`
    : undefined;
}

export type ThemePreset = {
  id: ThemePresetId;
  label: string;
  /** Two-tone preview: the chrome wash behind an accent dot, per mode. Mirrors
   *  the first and last wash stop and `--brand` / `--brand-2`. */
  swatch: {
    light: ThemePresetSwatch;
    dark: ThemePresetSwatch;
  };
};

export const THEME_PRESETS: ReadonlyArray<ThemePreset> = [
  {
    id: "keystone",
    label: "Keystone",
    swatch: {
      light: {
        chrome: "#3643a7",
        chrome2: "#222c72",
        accent: KEYSTONE_BRAND_HEX.light,
      },
      dark: {
        chrome: "#212540",
        chrome2: "#08090d",
        accent: KEYSTONE_BRAND_HEX.dark,
      },
    },
  },
  {
    id: "graphite",
    label: "Graphite",
    swatch: {
      light: { chrome: "#515259", chrome2: "#34353a", accent: "#4b4b55" },
      dark: { chrome: "#26262b", chrome2: "#09090b", accent: "#c9c9d2" },
    },
  },
  {
    id: "aurora",
    label: "Aurora",
    swatch: {
      light: {
        chrome: "#015a4f",
        chrome2: "#36236c",
        accent: "#0f7d71",
        accent2: "#6b59d3",
      },
      dark: {
        chrome: "#182f2d",
        chrome2: "#08090d",
        accent: "#5fd6c4",
        accent2: "#9d8df7",
      },
    },
  },
  {
    id: "sunset",
    label: "Sunset",
    swatch: {
      light: {
        chrome: "#8e3800",
        chrome2: "#600e38",
        accent: "#b65318",
        accent2: "#c0386f",
      },
      dark: {
        chrome: "#33231a",
        chrome2: "#0d0809",
        accent: "#f7a45c",
        accent2: "#ee6fa3",
      },
    },
  },
  {
    id: "nebula",
    label: "Nebula",
    swatch: {
      light: {
        chrome: "#6639a0",
        chrome2: "#00346c",
        accent: "#7450d6",
        accent2: "#2f6cc0",
      },
      dark: {
        chrome: "#261f40",
        chrome2: "#08090d",
        accent: "#b79cf7",
        accent2: "#6fa8ee",
      },
    },
  },
  {
    id: "lagoon",
    label: "Lagoon",
    swatch: {
      light: {
        chrome: "#015a5e",
        chrome2: "#013271",
        accent: "#02787d",
        accent2: "#1c65c8",
      },
      dark: {
        chrome: "#002d2f",
        chrome2: "#04060a",
        accent: "#37d6dd",
        accent2: "#85b6fe",
      },
    },
  },
  {
    id: "tropic",
    label: "Tropic",
    swatch: {
      light: {
        chrome: "#005b48",
        chrome2: "#273c00",
        accent: "#047b62",
        accent2: "#527700",
      },
      dark: {
        chrome: "#002e23",
        chrome2: "#050603",
        accent: "#57d8b4",
        accent2: "#9bc462",
      },
    },
  },
  {
    id: "orchid",
    label: "Orchid",
    swatch: {
      light: {
        chrome: "#8d2d7d",
        chrome2: "#39246c",
        accent: "#9d3d8d",
        accent2: "#6e4fc1",
      },
      dark: {
        chrome: "#381a32",
        chrome2: "#060509",
        accent: "#ef9ede",
        accent2: "#b6a5fe",
      },
    },
  },
  {
    id: "peach",
    label: "Peach",
    swatch: {
      light: {
        chrome: "#951b05",
        chrome2: "#5b2000",
        accent: "#b23a26",
        accent2: "#876204",
      },
      dark: {
        chrome: "#3f1a13",
        chrome2: "#080502",
        accent: "#ffa28f",
        accent2: "#dfab40",
      },
    },
  },
  {
    id: "glacier",
    label: "Glacier",
    swatch: {
      light: {
        chrome: "#005874",
        chrome2: "#003f3b",
        accent: "#147394",
        accent2: "#027972",
      },
      dark: {
        chrome: "#112a34",
        chrome2: "#040606",
        accent: "#8ac8e4",
        accent2: "#74c5be",
      },
    },
  },
  {
    id: "dusk",
    label: "Dusk",
    swatch: {
      light: {
        chrome: "#3a40a5",
        chrome2: "#640c29",
        accent: "#515bc3",
        accent2: "#b42f56",
      },
      dark: {
        chrome: "#1e2343",
        chrome2: "#090405",
        accent: "#aab9ff",
        accent2: "#fc8ea4",
      },
    },
  },
  {
    id: "berry",
    label: "Berry",
    swatch: {
      light: {
        chrome: "#931232",
        chrome2: "#4e1a5c",
        accent: "#b2354a",
        accent2: "#9041a7",
      },
      dark: {
        chrome: "#3f181d",
        chrome2: "#070508",
        accent: "#ff9ea6",
        accent2: "#d898ec",
      },
    },
  },
  {
    id: "candy",
    label: "Candy",
    swatch: {
      light: {
        chrome: "#7a2b56",
        chrome2: "#003b47",
        accent: "#9a4873",
        accent2: "#02768a",
      },
      dark: {
        chrome: "#371d29",
        chrome2: "#030607",
        accent: "#eca5c6",
        accent2: "#5dc5dc",
      },
    },
  },
  {
    id: "citrus",
    label: "Citrus",
    swatch: {
      light: {
        chrome: "#495400",
        chrome2: "#592000",
        accent: "#637103",
        accent2: "#935a00",
      },
      dark: {
        chrome: "#242a02",
        chrome2: "#080503",
        accent: "#b7c967",
        accent2: "#eca24a",
      },
    },
  },
  {
    id: "prism",
    label: "Prism",
    swatch: {
      light: {
        chrome: "#004d56",
        chrome2: "#520134",
        accent: "#077783",
        accent2: "#ab3276",
      },
      dark: {
        chrome: "#012c32",
        chrome2: "#090406",
        accent: "#3bd4e8",
        accent2: "#f48fc0",
      },
    },
  },
  {
    id: "mocha",
    label: "Mocha",
    swatch: {
      light: {
        chrome: "#784025",
        chrome2: "#522722",
        accent: "#8f5b32",
        accent2: "#97524a",
      },
      dark: {
        chrome: "#332216",
        chrome2: "#080505",
        accent: "#e0b392",
        accent2: "#e0a39a",
      },
    },
  },
  {
    id: "neon",
    label: "Neon",
    swatch: {
      light: {
        chrome: "#005226",
        chrome2: "#41055b",
        accent: "#037e3f",
        accent2: "#8e3ab8",
      },
      dark: {
        chrome: "#023014",
        chrome2: "#070509",
        accent: "#6ed88f",
        accent2: "#d595fb",
      },
    },
  },
];

/** Boundary guard — the DB column is free text, so every read is narrowed. */
export function isThemePresetId(v: unknown): v is ThemePresetId {
  return (
    typeof v === "string" && (THEME_PRESET_IDS as readonly string[]).includes(v)
  );
}

/** Ids that shipped once and were removed. A stored value keeps resolving to
 *  the closest current preset; the write boundary accepts current ids only, so
 *  the stored value is replaced the next time the user saves. */
export const LEGACY_THEME_PRESET_ALIASES: Readonly<Record<string, string>> = {
  ocean: "lagoon",
  forest: "tropic",
  ember: "peach",
  rose: "orchid",
};

/** Read boundary for a stored preset: current id, else its alias, else default. */
export function resolveThemePresetId(v: unknown): ThemePresetId {
  if (isThemePresetId(v)) return v;
  if (typeof v === "string") {
    const alias = LEGACY_THEME_PRESET_ALIASES[v];
    if (isThemePresetId(alias)) return alias;
  }
  return DEFAULT_THEME_PRESET;
}

/**
 * Stamp (or clear) the preset attribute on `<html>`. The default REMOVES the
 * attribute rather than writing `keystone`, so the base palette is always the
 * plain `:root` / `.dark` cascade — one less selector to keep in sync.
 */
export function applyThemePreset(id: ThemePresetId): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (id === DEFAULT_THEME_PRESET) root.removeAttribute(THEME_PRESET_ATTR);
  else root.setAttribute(THEME_PRESET_ATTR, id);
}

/**
 * Theme reach — how far a preset's colour travels into the app. A third axis
 * beside mode and preset, stamped on `<html>` as `data-theme-reach`.
 *
 * Reach never touches a preset's seed tokens: it is a derived layer declared
 * once in `src/app/globals.css` (the four `--reach-*` tokens) that mixes a
 * little `--brand` into the content card, the raised surfaces and the hover
 * fill. `subtle` zeroes every token — the pre-reach look, exactly. `tinted` is
 * the default and, like `keystone`, has NO CSS block: it IS the `:root`
 * values. `vivid` raises the mix and switches the header glow on.
 */
export const THEME_REACH_IDS = ["subtle", "tinted", "vivid"] as const;

export type ThemeReachId = (typeof THEME_REACH_IDS)[number];

/** The `:root` percentages. Has no override block. */
export const DEFAULT_THEME_REACH: ThemeReachId = "tinted";

/** localStorage key for the inline no-flash script. */
export const THEME_REACH_STORAGE_KEY = "monolith-theme-reach";

/** Attribute stamped on `<html>`. Absent means the default reach. */
export const THEME_REACH_ATTR = "data-theme-reach";

/** Boundary guard — the DB column is free text, so every read is narrowed. */
export function isThemeReachId(v: unknown): v is ThemeReachId {
  return (
    typeof v === "string" && (THEME_REACH_IDS as readonly string[]).includes(v)
  );
}

/**
 * Stamp (or clear) the reach attribute on `<html>`. The default REMOVES the
 * attribute rather than writing `tinted`, mirroring `applyThemePreset`.
 */
export function applyThemeReach(id: ThemeReachId): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (id === DEFAULT_THEME_REACH) root.removeAttribute(THEME_REACH_ATTR);
  else root.setAttribute(THEME_REACH_ATTR, id);
}

/**
 * Forget this device's copy of the account's reach: the `<html>` attribute and
 * the localStorage key the no-flash script reads. Called at sign-out, so the
 * next person on a shared browser starts from the default instead of the
 * previous account's choice. The attribute goes first and unconditionally;
 * storage may be unavailable (private mode), which must not stop a sign-out.
 */
export function forgetThemeReach(): void {
  if (typeof document === "undefined") return;
  document.documentElement.removeAttribute(THEME_REACH_ATTR);
  try {
    localStorage.removeItem(THEME_REACH_STORAGE_KEY);
  } catch {
    // Storage disabled — there is no stored copy to leak.
  }
}
