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
 * Adding a preset means three things, all guarded by tests: an entry here, the
 * two CSS blocks (`presets.test.ts` checks the token sets match exactly), and a
 * green `globals.contrast.test.ts` (which iterates this list).
 */

export const THEME_PRESET_IDS = [
  "keystone",
  "graphite",
  "ocean",
  "forest",
  "ember",
  "rose",
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

export type ThemePreset = {
  id: ThemePresetId;
  label: string;
  /** Two-tone preview: the chrome wash behind an accent dot, per mode. Mirrors
   *  the mid wash stop (light) / top wash stop (dark) and `--brand`. */
  swatch: {
    light: { chrome: string; accent: string };
    dark: { chrome: string; accent: string };
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
    id: "ocean",
    label: "Ocean",
    swatch: {
      light: { chrome: "#d2e2e8", accent: "#1f7a8c" },
      dark: { chrome: "#1b3037", accent: "#6fc6d6" },
    },
  },
  {
    id: "forest",
    label: "Forest",
    swatch: {
      light: { chrome: "#d6e3da", accent: "#2f7a4f" },
      dark: { chrome: "#1d3126", accent: "#7fcf9c" },
    },
  },
  {
    id: "ember",
    label: "Ember",
    swatch: {
      light: { chrome: "#e8dbcf", accent: "#b4581a" },
      dark: { chrome: "#332419", accent: "#f0a868" },
    },
  },
  {
    id: "rose",
    label: "Rose",
    swatch: {
      light: { chrome: "#e8d5dc", accent: "#b8375f" },
      dark: { chrome: "#33202a", accent: "#f08fb0" },
    },
  },
];

/** Boundary guard — the DB column is free text, so every read is narrowed. */
export function isThemePresetId(v: unknown): v is ThemePresetId {
  return (
    typeof v === "string" && (THEME_PRESET_IDS as readonly string[]).includes(v)
  );
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
