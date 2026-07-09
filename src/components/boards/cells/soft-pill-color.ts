import { contrastRatio } from "@/lib/boards/contrast";

/**
 * Contrast-aware text colors for a Keystone *soft* status/label pill.
 *
 * A soft pill is a translucent 15% tint of the user's chosen option hex over the
 * board surface. Colored text on that fill reads best, but a fixed blend can't
 * guarantee legibility across arbitrary user hues: a dark hue in dark mode
 * (navy on near-black) or a pale hue in light mode (pale yellow on near-white)
 * would fail WCAG AA. This derives per-theme text colors that keep the colored
 * feel for mid-tones but escalate toward black (light) / white (dark) only as
 * far as needed to clear ≥4.5:1 against the pill's *effective* background.
 *
 * Returns `{ light, dark }` hex strings, applied as CSS custom properties so a
 * single element can carry both and let the theme pick via a `dark:` variant.
 */

const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];
/** Near-black / white fallbacks (mirror `contrast.ts`'s DARK_FG / LIGHT_FG). */
const DARK_FG = "#1a1a1d";
const LIGHT_FG = "#ffffff";
// Worst-case (hardest-to-contrast) board surface per theme: the muted/sunken
// step sits slightly closer in lightness to the pill text than the base card
// surface, so clearing AA against it clears `--surface` too.
const SURFACE_LIGHT: RGB = [0xf1, 0xf1, 0xf4]; // #f1f1f4
const SURFACE_DARK: RGB = [0x1c, 0x1c, 0x20]; // #1c1c20
const PILL_FILL_ALPHA = 0.15; // matches the `color-mix(... 15% ...)` fill

type RGB = [number, number, number];

function parseHex(hex: string): RGB | null {
  if (typeof hex !== "string") return null;
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toHex([r, g, b]: RGB): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Alpha-composite `fg` over opaque `bg` at `alpha` (gamma space — a close
 *  enough approximation of the translucent fill for contrast selection). */
function composite(fg: RGB, bg: RGB, alpha: number): RGB {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}

/** Per-channel blend of `a` toward `b` by fraction `t` (0→a, 1→b). */
function blend(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** Escalate `base` toward `toward` from `startT` until it clears AA on the pill
 *  fill over `surface`; fall back to the pure extreme if nothing else does. */
function legibleOn(
  base: RGB,
  surface: RGB,
  toward: RGB,
  startT: number,
): string {
  const bg = toHex(composite(base, surface, PILL_FILL_ALPHA));
  for (let t = startT; t <= 1.0001; t += 0.08) {
    const candidate = toHex(blend(base, toward, Math.min(t, 1)));
    if (contrastRatio(candidate, bg) >= 4.5) return candidate;
  }
  return toHex(toward);
}

export function softPillText(bg: string): { light: string; dark: string } {
  const rgb = parseHex(bg);
  if (!rgb) return { light: DARK_FG, dark: LIGHT_FG };
  return {
    // Light: darken toward black, starting at the 35%-toward-black tone that
    // still reads as "colored". Dark: lighten toward white as needed.
    light: legibleOn(rgb, SURFACE_LIGHT, BLACK, 0.35),
    dark: legibleOn(rgb, SURFACE_DARK, WHITE, 0),
  };
}
