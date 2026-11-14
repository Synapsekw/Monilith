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
 * declare it equal to `--brand`; `aurora`, `sunset` and `nebula` give it a second hue,
 * which is all that makes them "gradient" presets — `--brand-gradient` is
 * derived once in `:root` from the two.
 *
 * Adding a preset means three things, all guarded by tests: an entry here, the
 * two CSS blocks (`presets.test.ts` checks the token sets match exactly), and a
 * green `globals.contrast.test.ts` (which iterates this list).
 */

export const THEME_PRESET_IDS = [
  "keystone",
  "graphite",
  "aurora",
  "sunset",
  "nebula",
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

/** One mode's preview. `accent2` mirrors `--brand-2` and is set ONLY by the
 *  two-accent presets (aurora, sunset, nebula): its presence is what turns the
 *  accent dot into a two-stop gradient. */
export type ThemePresetSwatch = {
  chrome: string;
  accent: string;
  accent2?: string;
};

/** The CSS `background` for a swatch's accent dot: flat for a single-accent
 *  preset; the same two stops and direction as `--brand-gradient` when the
 *  preset carries a second one. Shared by every surface that previews presets. */
export function swatchAccentFill({
  accent,
  accent2,
}: ThemePresetSwatch): string {
  return accent2 ? `linear-gradient(90deg, ${accent}, ${accent2})` : accent;
}

export type ThemePreset = {
  id: ThemePresetId;
  label: string;
  /** Two-tone preview: the chrome wash behind an accent dot, per mode. Mirrors
   *  the mid wash stop (light) / top wash stop (dark) and `--brand`. */
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
      light: { chrome: "#d6dbee", accent: KEYSTONE_BRAND_HEX.light },
      dark: { chrome: "#212540", accent: KEYSTONE_BRAND_HEX.dark },
    },
  },
  {
    id: "graphite",
    label: "Graphite",
    swatch: {
      light: { chrome: "#dadade", accent: "#4b4b55" },
      dark: { chrome: "#26262b", accent: "#c9c9d2" },
    },
  },
  {
    id: "aurora",
    label: "Aurora",
    swatch: {
      light: { chrome: "#d5dfe9", accent: "#0f7d71", accent2: "#6b59d3" },
      dark: { chrome: "#182f2d", accent: "#5fd6c4", accent2: "#9d8df7" },
    },
  },
  {
    id: "sunset",
    label: "Sunset",
    swatch: {
      light: { chrome: "#ead8d6", accent: "#b65318", accent2: "#c0386f" },
      dark: { chrome: "#33231a", accent: "#f7a45c", accent2: "#ee6fa3" },
    },
  },
  {
    id: "nebula",
    label: "Nebula",
    swatch: {
      light: { chrome: "#d9dcef", accent: "#7450d6", accent2: "#2f6cc0" },
      dark: { chrome: "#261f40", accent: "#b79cf7", accent2: "#6fa8ee" },
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
