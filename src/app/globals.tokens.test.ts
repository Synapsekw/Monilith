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
const THEME_INVARIANT = new Set(["--radius"]);

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
      "--text-2xs:",
      "--text-3xs:",
    ]) {
      expect(CSS, `${entry} not registered in @theme`).toContain(entry);
    }
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
