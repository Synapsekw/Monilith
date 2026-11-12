import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** Extract the custom-property names declared inside a top-level block. */
function tokensIn(selector: string): Set<string> {
  // Match `selector {` up to the matching close at column 0 (`\n}`).
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const end = CSS.indexOf("\n}", start);
  const body = CSS.slice(start, end);
  return new Set(
    [...body.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((m) => m[1]),
  );
}

const NEW_TOKENS = [
  "--app-wash",
  "--app-bloom",
  "--content-surface",
  "--content-edge",
  "--content-lift",
  "--state-hover",
  "--state-active",
  "--state-selected",
  "--chrome-fill",
  "--scrollbar-thumb",
];

/**
 * Tokens deliberately declared once in `:root` because they do not vary by
 * theme. `--radius` is the only pre-existing one; keep this list short and
 * justified — it is the escape hatch that could hide a real parity bug.
 */
const THEME_INVARIANT = new Set([
  "--radius",
  // The lit-seam bloom is written in terms of `var(--foreground)`, which every
  // theme and preset already redefines. Declaring it twice would be the same
  // string twice, and a second copy is a second thing to forget.
  "--seam-glow",
  // Reach is its own axis ([data-theme-reach] on <html>), orthogonal to mode:
  // the percentages are the same in light and dark, so they are declared once
  // and moved only by the two reach blocks.
  "--reach-content",
  "--reach-surface",
  "--reach-hover",
  "--reach-glow",
]);

describe("Keystone token contract", () => {
  it("declares every wash/state token in both themes", () => {
    const root = tokensIn(":root");
    const dark = tokensIn(".dark");
    for (const token of NEW_TOKENS) {
      expect(root, `${token} missing from :root`).toContain(token);
      expect(dark, `${token} missing from .dark`).toContain(token);
    }
  });

  it("keeps light and dark palettes at parity", () => {
    const root = tokensIn(":root");
    const dark = tokensIn(".dark");
    const onlyLight = [...root].filter(
      (t) => !dark.has(t) && !THEME_INVARIANT.has(t),
    );
    const onlyDark = [...dark].filter(
      (t) => !root.has(t) && !THEME_INVARIANT.has(t),
    );
    expect({ onlyLight, onlyDark }).toEqual({ onlyLight: [], onlyDark: [] });
  });

  it("registers the tokens Tailwind needs to emit utilities", () => {
    for (const entry of [
      "--color-state-hover:",
      "--color-state-active:",
      "--color-state-selected:",
      "--color-chrome-fill:",
      "--color-content-surface:",
      "--color-content-edge:",
      "--shadow-content-lift:",
      "--shadow-drag:",
      "--text-2xs:",
      "--text-3xs:",
      "--color-chart-spectrum-1:",
      "--color-chart-spectrum-2:",
      "--color-chart-spectrum-3:",
    ]) {
      expect(CSS, `${entry} not registered in @theme`).toContain(entry);
    }
  });

  it("backs --shadow-drag with a named --elevation-drag token, not itself", () => {
    // A self-referential custom property (`--shadow-drag: var(--shadow-drag)`)
    // resolves to nothing — mirrors the --shadow-panel/--elevation-panel split.
    expect(CSS).toContain("--shadow-drag: var(--elevation-drag);");
    expect(CSS).not.toContain("--shadow-drag: var(--shadow-drag);");
    const root = tokensIn(":root");
    const dark = tokensIn(".dark");
    expect(root, "--elevation-drag missing from :root").toContain(
      "--elevation-drag",
    );
    expect(dark, "--elevation-drag missing from .dark").toContain(
      "--elevation-drag",
    );
  });

  it("declares the named motion scale", () => {
    for (const d of [
      "--duration-instant: 120ms",
      "--duration-fast: 180ms",
      "--duration-standard: 240ms",
      "--duration-arrival: 500ms",
      "--ease-standard: cubic-bezier(0.25, 1, 0.5, 1)",
    ]) {
      expect(CSS).toContain(d);
    }
  });
});

/** The value of one custom property inside a top-level block. */
function valueIn(selector: string, token: string): string {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const body = CSS.slice(start, CSS.indexOf("\n}", start));
  const m = body.match(new RegExp(`^\\s{2}${token}:\\s*([^;]+);`, "m"));
  if (!m) throw new Error(`${token} not declared in ${selector}`);
  return m[1].trim();
}

/** Whitespace-insensitive view, so a prettier re-wrap cannot break a match. */
const FLAT = CSS.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")");

const REACH_TOKENS = [
  "--reach-content",
  "--reach-surface",
  "--reach-hover",
  "--reach-glow",
] as const;

function reachValues(selector: string): string[] {
  return REACH_TOKENS.map((t) => valueIn(selector, t));
}

describe("theme reach tokens", () => {
  it("declares the Tinted defaults in :root, with dark's own content value", () => {
    // Light content is 2.5%, not the spec's 5%: tinting a white card darkens
    // it towards the chrome, and 2.5% is the most that keeps the 1.15:1
    // band/card floor in every light preset (globals.contrast.test.ts).
    expect(reachValues(":root")).toEqual(["2.5%", "4%", "8%", "0"]);
    // --reach-content is the ONE per-mode reach token.
    expect(valueIn(".dark", "--reach-content")).toBe("5%");
    const dark = tokensIn(".dark");
    for (const t of REACH_TOKENS.filter((t) => t !== "--reach-content")) {
      expect(dark, t).not.toContain(t);
    }
  });

  it("subtle zeroes all four — every derived token resolves to its seed", () => {
    expect(reachValues('[data-theme-reach="subtle"]')).toEqual([
      "0%",
      "0%",
      "0%",
      "0",
    ]);
    expect([...tokensIn('[data-theme-reach="subtle"]')].sort()).toEqual(
      [...REACH_TOKENS].sort(),
    );
  });

  it("vivid sets the documented values", () => {
    // Surface and hover are 5% / 8%, not the spec's starting 7% / 13%: those
    // failed AA for muted text on a hovered row inside a muted surface, and
    // the spec's rule is "if a value fails, lower it" (globals.contrast.test.ts).
    // Light content stays at the tinted 2.5% (the separation floor again);
    // dark vivid gets the spec's 9% from its own, more specific block.
    expect(reachValues('[data-theme-reach="vivid"]')).toEqual([
      "2.5%",
      "5%",
      "8%",
      "1",
    ]);
    expect([...tokensIn('[data-theme-reach="vivid"]')].sort()).toEqual(
      [...REACH_TOKENS].sort(),
    );
    expect([...tokensIn('.dark[data-theme-reach="vivid"]')]).toEqual([
      "--reach-content",
    ]);
    expect(valueIn('.dark[data-theme-reach="vivid"]', "--reach-content")).toBe(
      "9%",
    );
  });

  it("puts the reach blocks after :root AND .dark so they win at equal specificity", () => {
    // `.dark` now declares --reach-content, so subtle must come after it too
    // or dark + subtle would keep dark's 5%.
    const dark = CSS.indexOf("\n.dark {");
    expect(dark).toBeGreaterThan(CSS.indexOf(":root {"));
    expect(CSS.indexOf('\n[data-theme-reach="subtle"] {')).toBeGreaterThan(
      dark,
    );
    expect(CSS.indexOf('\n[data-theme-reach="vivid"] {')).toBeGreaterThan(dark);
  });

  it("routes the surface aliases through reach with an sRGB mix", () => {
    // Seed FIRST: Tailwind's no-color-mix fallback is the first colour, and it
    // must be the untinted surface rather than a solid brand fill.
    const alias = (name: string, reach: string) =>
      `--color-${name}: color-mix(in srgb, var(--${name}), var(--brand) var(--reach-${reach}));`;
    expect(FLAT).toContain(alias("content-surface", "content"));
    for (const name of [
      "surface",
      "surface-muted",
      "surface-sunken",
      "card",
      "popover",
      "muted",
      "accent",
      "secondary",
    ]) {
      expect(FLAT, name).toContain(alias(name, "surface"));
    }
    expect(FLAT).toContain(alias("state-hover", "hover"));
  });

  it("draws the header glow as one decorative, reach-gated ::before", () => {
    const m = FLAT.match(/\.content-glow::before \{([^}]*)\}/);
    expect(m, ".content-glow::before missing").not.toBeNull();
    const body = m![1];
    expect(body).toMatch(/opacity: var\(--reach-glow\)/);
    expect(body).toMatch(/pointer-events: none/);
    expect(body.match(/radial-gradient\(/g)).toHaveLength(2);
    expect(body).toContain("var(--brand)");
    expect(body).toContain("var(--brand-2, var(--brand))");
  });

  it("keeps print output untinted and glow-free", () => {
    const print = FLAT.split("@media print")[1] ?? "";
    expect(print).toMatch(/\.content-glow::before \{[^}]*display: none/);
    const printRoot = print.match(/\[data-print-root\] \{[^}]*\}/)?.[0] ?? "";
    for (const t of ["--reach-content", "--reach-surface", "--reach-hover"]) {
      expect(printRoot).toContain(`${t}: 0%`);
    }
  });
});

describe("base-layer polish", () => {
  it("restores the pointer cursor on interactive elements", () => {
    expect(CSS).toMatch(/button:not\(:disabled\)/);
    expect(CSS).toContain("cursor: pointer");
  });

  it("contains overscroll on both axes, not just x", () => {
    expect(CSS).toContain("overscroll-behavior: none");
    expect(CSS).not.toContain("overscroll-behavior-x: none");
  });

  it("reserves the gutter for main AND the opt-in hook — not for everything", () => {
    // A substring check for "scrollbar-gutter: stable" passes even if the
    // selector is reverted to `*`, which is what hid follow-up #4. Assert the
    // selector list itself.
    expect(CSS).toMatch(
      /\bmain,\s*\[data-scroll-container\]\s*\{\s*scrollbar-gutter:\s*stable;/,
    );
    // `*` would put a permanent 10px dead strip in every dropdown and popover.
    expect(CSS).not.toMatch(/^\s*\*\s*\{\s*scrollbar-gutter/m);
  });

  it("gives the scrollbar thumb its own token, not the interaction fill", () => {
    // --state-active is the PRESSED fill for rows, menu items and buttons.
    // Reusing it here means "make the scrollbar visible" and "make the pressed
    // state stronger" are the same knob — see follow-up #5.
    expect(CSS).toMatch(
      /:hover::-webkit-scrollbar-thumb,\s*:focus-within::-webkit-scrollbar-thumb\s*\{\s*background:\s*var\(--scrollbar-thumb\);/,
    );
    // Firefox has no thumb-hover selector, so its fallback is the ONLY value
    // it ever gets. Missing this is how the fix half-lands.
    expect(CSS).toMatch(
      /scrollbar-color:\s*var\(--scrollbar-thumb\)\s+transparent;/,
    );
    expect(CSS).not.toMatch(/scrollbar-color:\s*var\(--state-active\)/);
  });
});
