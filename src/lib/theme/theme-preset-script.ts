import {
  DEFAULT_THEME_PRESET,
  THEME_PRESET_ATTR,
  THEME_PRESET_IDS,
  THEME_PRESET_STORAGE_KEY,
} from "./presets";

/**
 * The no-flash script, injected into `<head>` by the root layout. It runs
 * synchronously while the browser parses the document, so the preset attribute
 * is on `<html>` before the first paint — the same technique next-themes uses
 * for the light/dark class, and the one Next documents for exactly this problem
 * ("Preventing flash before hydration").
 *
 * It cannot be a Client Component: anything that waits for hydration paints the
 * default palette first, and re-painting the whole chrome one frame later is
 * precisely the flash. `ThemePresetSync` is the second half of the pair — it
 * corrects localStorage from the server value once the shell streams in, which
 * is what makes the preset follow the user to a new device.
 *
 * Built from `THEME_PRESET_IDS` rather than a hand-written list so a new preset
 * cannot be accepted here but rejected by the Zod boundary (or vice versa). The
 * id whitelist matters: the value is attacker-controllable in the sense that
 * anyone can write to their own localStorage, and it lands in a DOM attribute.
 * The default writes NO attribute, so a stored "keystone" is a no-op.
 */
export const THEME_PRESET_INLINE_SCRIPT = `(function(){try{var v=localStorage.getItem(${JSON.stringify(THEME_PRESET_STORAGE_KEY)});if(v&&${JSON.stringify([...THEME_PRESET_IDS])}.indexOf(v)>-1&&v!==${JSON.stringify(DEFAULT_THEME_PRESET)}){document.documentElement.setAttribute(${JSON.stringify(THEME_PRESET_ATTR)},v)}}catch(e){}})();`;
