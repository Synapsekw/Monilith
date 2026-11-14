import {
  DEFAULT_THEME_PRESET,
  DEFAULT_THEME_REACH,
  LEGACY_THEME_PRESET_ALIASES,
  THEME_PRESET_ATTR,
  THEME_PRESET_IDS,
  THEME_PRESET_STORAGE_KEY,
  THEME_REACH_ATTR,
  THEME_REACH_IDS,
  THEME_REACH_STORAGE_KEY,
} from "./presets";

/** One `s(key, ids, default, attr[, aliases])` call in the inline script, with
 *  every argument serialised as a JSON literal. `aliases` maps a removed id to
 *  its replacement and is consulted BEFORE the whitelist, so an alias can only
 *  ever stamp a current id. */
function stamp(
  storageKey: string,
  ids: readonly string[],
  fallback: string,
  attr: string,
  aliases?: Readonly<Record<string, string>>,
): string {
  const tail = aliases ? `,${JSON.stringify(aliases)}` : "";
  return `s(${JSON.stringify(storageKey)},${JSON.stringify([...ids])},${JSON.stringify(fallback)},${JSON.stringify(attr)}${tail})`;
}

/**
 * The no-flash script, injected into `<head>` by the root layout. It runs
 * synchronously while the browser parses the document, so the preset AND reach
 * attributes are on `<html>` before the first paint — the same technique
 * next-themes uses for the light/dark class, and the one Next documents for
 * exactly this problem ("Preventing flash before hydration").
 *
 * It cannot be a Client Component: anything that waits for hydration paints the
 * default palette first, and re-painting the whole chrome one frame later is
 * precisely the flash. `ThemePresetSync` is the second half of the pair — it
 * corrects localStorage from the server value once the shell streams in, which
 * is what makes the preset and reach follow the user to a new device.
 *
 * Built from `THEME_PRESET_IDS` / `THEME_REACH_IDS` rather than hand-written
 * lists so a new id cannot be accepted here but rejected by the Zod boundary
 * (or vice versa). The id whitelist matters: the value is attacker-controllable
 * in the sense that anyone can write to their own localStorage, and it lands in
 * a DOM attribute. The default writes NO attribute, so a stored "keystone" or
 * "tinted" is a no-op. A preset id that was removed is first swapped for its
 * replacement (`LEGACY_THEME_PRESET_ALIASES`) and then whitelisted like any
 * other value, so an alias whose target is not a current id stamps nothing.
 *
 * One script, two axes: both go through the same tiny `s()` so they can never
 * disagree on the rules. Each call has its own try/catch — a storage read that
 * throws for one key must not cost the other its stamp.
 */
export const THEME_PRESET_INLINE_SCRIPT = `(function(){function s(k,a,d,n,m){try{var v=localStorage.getItem(k);if(v&&m&&m[v])v=m[v];if(v&&a.indexOf(v)>-1&&v!==d){document.documentElement.setAttribute(n,v)}}catch(e){}}${stamp(
  THEME_PRESET_STORAGE_KEY,
  THEME_PRESET_IDS,
  DEFAULT_THEME_PRESET,
  THEME_PRESET_ATTR,
  LEGACY_THEME_PRESET_ALIASES,
)};${stamp(
  THEME_REACH_STORAGE_KEY,
  THEME_REACH_IDS,
  DEFAULT_THEME_REACH,
  THEME_REACH_ATTR,
)}})();`;
